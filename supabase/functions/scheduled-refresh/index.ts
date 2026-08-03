import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Nightly incremental refresh of every run flagged auto_refresh.
 *
 * Invoked by pg_cron via pg_net, not by a browser. Authentication is the
 * service-role key compared against this function's own environment, so there
 * is no extra secret for the owner to set - the cron job reads the same key
 * out of Supabase Vault.
 *
 * The YouTube walk is duplicated from the browser client on purpose: cron has
 * no browser to run it in. Behaviour is kept deliberately identical - results
 * come back newest-first, so paging a video stops at the first comment older
 * than the cutoff.
 */

const YT = "https://www.googleapis.com/youtube/v3/";

// Edge functions are wall-clock limited. Stop cleanly and record a partial run
// rather than being killed mid-insert.
const DEADLINE_MS = 100_000;
const started = () => Date.now();

type Run = {
  id: string; user_id: string; name: string; platform: string;
  source_type: string; source_value: string | null;
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function ytFetch(endpoint: string, params: Record<string, string>, apiKey: string) {
  const url = new URL(YT + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? "YouTube API error") as Error & { reason?: string };
    err.reason = data?.error?.errors?.[0]?.reason ?? "";
    throw err;
  }
  return data;
}

async function listVideos(run: Run, apiKey: string): Promise<{ id: string; title: string }[]> {
  const value = run.source_value ?? "";
  if (!value) throw new Error("Run has no recorded source value.");

  if (run.source_type === "video") {
    const r = await ytFetch("videos", { part: "snippet", id: value }, apiKey);
    if (!r.items?.length) throw new Error("Video not found.");
    return [{ id: value, title: r.items[0].snippet.title }];
  }

  let playlistId: string;
  if (run.source_type === "playlist") {
    playlistId = value;
  } else {
    // channel / handle / search all resolve to a channel, then its uploads playlist.
    let channelId = value;
    if (run.source_type === "handle") {
      const r = await ytFetch("channels", { part: "id", forHandle: value }, apiKey);
      if (!r.items?.length) throw new Error("Channel not found for handle.");
      channelId = r.items[0].id;
    } else if (run.source_type === "search") {
      // search.list costs 100 units; only reached for runs saved from a plain name.
      const r = await ytFetch("search", { part: "snippet", q: value, type: "channel", maxResults: "1" }, apiKey);
      if (!r.items?.length) throw new Error("Channel not found by name.");
      channelId = r.items[0].snippet.channelId;
    }
    const c = await ytFetch("channels", { part: "contentDetails", id: channelId }, apiKey);
    if (!c.items?.length) throw new Error("Channel not found.");
    playlistId = c.items[0].contentDetails.relatedPlaylists.uploads;
  }

  const videos: { id: string; title: string }[] = [];
  let pageToken = "";
  do {
    const r = await ytFetch(
      "playlistItems",
      { part: "snippet", playlistId, maxResults: "50", pageToken },
      apiKey,
    );
    for (const it of r.items ?? []) {
      const id = it.snippet?.resourceId?.videoId;
      const title = it.snippet?.title ?? "";
      if (id && title !== "Deleted video" && title !== "Private video") videos.push({ id, title });
    }
    pageToken = r.nextPageToken ?? "";
  } while (pageToken);
  return videos;
}

type NewComment = {
  comment_id: string; video_id: string; video_title: string;
  author: string; text: string; published_at: string;
  likes: number; reply_count: number; is_reply: boolean;
};

async function commentsSince(
  video: { id: string; title: string },
  cutoffMs: number,
  apiKey: string,
): Promise<{ rows: NewComment[]; fatal: boolean }> {
  const rows: NewComment[] = [];
  let pageToken = "";
  try {
    do {
      const r = await ytFetch("commentThreads", {
        part: "snippet,replies", videoId: video.id, maxResults: "100",
        order: "time", pageToken, textFormat: "plainText",
      }, apiKey);

      let reachedOld = false;
      for (const item of r.items ?? []) {
        const top = item.snippet.topLevelComment.snippet;
        if (new Date(top.publishedAt).getTime() <= cutoffMs) { reachedOld = true; continue; }
        rows.push({
          comment_id: item.snippet.topLevelComment.id ?? item.id,
          video_id: video.id, video_title: video.title,
          author: top.authorDisplayName ?? "", text: top.textDisplay ?? "",
          published_at: top.publishedAt, likes: top.likeCount ?? 0,
          reply_count: item.snippet.totalReplyCount ?? 0, is_reply: false,
        });
        for (const rep of item.replies?.comments ?? []) {
          const rs = rep.snippet;
          rows.push({
            comment_id: rep.id,
            video_id: video.id, video_title: video.title,
            author: rs.authorDisplayName ?? "", text: rs.textDisplay ?? "",
            published_at: rs.publishedAt, likes: rs.likeCount ?? 0,
            reply_count: 0, is_reply: true,
          });
        }
      }
      if (reachedOld) break;
      pageToken = r.nextPageToken ?? "";
    } while (pageToken);
  } catch (e) {
    // Comments disabled is per-video and expected; quota exhaustion is fatal.
    return { rows, fatal: (e as { reason?: string }).reason === "quotaExceeded" };
  }
  return { rows, fatal: false };
}

const GRAPH = "https://graph.facebook.com/v21.0/";

async function metaGraph(path: string, params: Record<string, string>, token: string) {
  const url = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const r = await fetch(url.toString());
  const d = await r.json();
  if (!r.ok) {
    const e = new Error(d?.error?.message ?? "Meta API error") as Error & { status?: number };
    e.status = r.status;
    throw e;
  }
  return d;
}

function mapRow(it: Record<string, any>, post: { id: string; title: string }, isFB: boolean, isReply: boolean): NewComment {
  return {
    comment_id: it.id,
    video_id: post.id, video_title: post.title,
    author: (isFB ? it.from?.name : it.username) ?? "",
    text: (isFB ? it.message : it.text) ?? "",
    published_at: (isFB ? it.created_time : it.timestamp) ?? "",
    likes: it.like_count ?? 0,
    reply_count: isFB ? (it.comment_count ?? 0) : 0,
    is_reply: isReply,
  };
}

async function metaListPosts(run: Run, token: string, pageId: string): Promise<{ id: string; title: string }[]> {
  const isFB = run.platform === "facebook";
  if (run.source_type === "post" && run.source_value) {
    return [{ id: run.source_value, title: isFB ? "Facebook post" : "Instagram media" }];
  }
  let node = pageId;
  let edge = "posts";
  let fields = "id,message,created_time";
  if (!isFB) {
    const pg = await metaGraph(pageId, { fields: "instagram_business_account" }, token);
    node = pg?.instagram_business_account?.id;
    if (!node) throw new Error("No Instagram Business account linked to the Page.");
    edge = "media";
    fields = "id,caption,timestamp";
  }
  const out: { id: string; title: string }[] = [];
  let after = "";
  while (out.length < 300) {
    const params: Record<string, string> = { fields, limit: "25" };
    if (after) params.after = after;
    const r = await metaGraph(`${node}/${edge}`, params, token);
    for (const p of r.data ?? []) {
      out.push({ id: p.id, title: ((isFB ? p.message : p.caption) ?? "(no caption)").replace(/\s+/g, " ").slice(0, 60) });
    }
    after = r.paging?.cursors?.after ?? "";
    if (!r.paging?.next || !after) break;
  }
  return out;
}

async function metaCommentsSince(
  post: { id: string; title: string }, cutoffMs: number, token: string, isFB: boolean,
): Promise<{ rows: NewComment[]; fatal: boolean }> {
  const rows: NewComment[] = [];
  const fields = isFB
    ? "id,message,from,created_time,like_count,comment_count,comments.limit(50){id,message,from,created_time,like_count}"
    : "id,text,username,timestamp,like_count,replies.limit(50){id,text,username,timestamp,like_count}";
  let after = "";
  try {
    while (true) {
      const params: Record<string, string> = { fields, limit: "50" };
      if (isFB) params.order = "reverse_chronological";
      if (after) params.after = after;
      const r = await metaGraph(`${post.id}/comments`, params, token);
      let reachedOld = false;
      for (const it of r.data ?? []) {
        const t = isFB ? it.created_time : it.timestamp;
        if (new Date(t).getTime() <= cutoffMs) { reachedOld = true; if (isFB) break; else continue; }
        rows.push(mapRow(it, post, isFB, false));
        for (const rep of (isFB ? it.comments?.data : it.replies?.data) ?? []) rows.push(mapRow(rep, post, isFB, true));
      }
      if (reachedOld && isFB) break;
      after = r.paging?.cursors?.after ?? "";
      if (!r.paging?.next || !after) break;
    }
  } catch (e) {
    const st = (e as { status?: number }).status;
    return { rows, fatal: st === 401 || st === 403 };
  }
  return { rows, fatal: false };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  // Only the cron job may call this. The service-role key is compared against
  // this function's own environment, so no additional secret is needed.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!serviceKey || token !== serviceKey) {
    return json({ error: "Not authorised." }, 401);
  }

  const ytKey = Deno.env.get("YOUTUBE_API_KEY") ?? "";
  const metaToken = Deno.env.get("META_PAGE_TOKEN") ?? "";
  const metaPageId = Deno.env.get("META_PAGE_ID") ?? "";

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const t0 = started();

  const { data: runs, error } = await admin
    .from("runs")
    .select("id,user_id,name,platform,source_type,source_value")
    .eq("auto_refresh", true);
  if (error) return json({ error: error.message }, 500);
  if (!runs?.length) return json({ ok: true, runs: 0, note: "No runs are flagged for auto refresh." }, 200);

  const summary: Record<string, unknown>[] = [];

  for (const run of runs as Run[]) {
    let status = "ok";
    let detail: string | null = null;
    let added = 0;

    try {
      // Cutoff: the newest comment already stored for this run.
      const { data: newest } = await admin
        .from("comments").select("published_at")
        .eq("run_id", run.id).order("published_at", { ascending: false }).limit(1);
      const cutoffMs = newest?.[0]?.published_at ? new Date(newest[0].published_at).getTime() : 0;
      if (!cutoffMs) throw new Error("Run has no dated comments to refresh from.");

      const isMeta = run.platform === "facebook" || run.platform === "instagram";
      if (isMeta && (!metaToken || !metaPageId)) throw new Error("META_PAGE_TOKEN / META_PAGE_ID not configured.");
      if (!isMeta && !ytKey) throw new Error("YOUTUBE_API_KEY not configured.");

      const containers = isMeta
        ? await metaListPosts(run, metaToken, metaPageId)
        : await listVideos(run, ytKey);
      const fresh: NewComment[] = [];

      for (const c of containers) {
        if (Date.now() - t0 > DEADLINE_MS) {
          status = "partial";
          detail = `Stopped on the time budget after ${fresh.length} new comment(s).`;
          break;
        }
        const r = isMeta
          ? await metaCommentsSince(c, cutoffMs, metaToken, run.platform === "facebook")
          : await commentsSince(c, cutoffMs, ytKey);
        fresh.push(...r.rows);
        if (r.fatal) { status = "partial"; detail = isMeta ? "Meta token/permission error." : "YouTube quota exhausted."; break; }
      }

      if (fresh.length) {
        // The partial unique index on (run_id, comment_id) makes this safe to
        // re-run: a comment already stored is ignored rather than duplicated.
        const CHUNK = 500;
        for (let i = 0; i < fresh.length; i += CHUNK) {
          const rows = fresh.slice(i, i + CHUNK).map((c) => ({ ...c, run_id: run.id, user_id: run.user_id }));
          const { error: insErr } = await admin
            .from("comments").upsert(rows, { onConflict: "run_id,comment_id", ignoreDuplicates: true });
          if (insErr) throw insErr;
        }
        added = fresh.length;
      }

      const { count } = await admin
        .from("comments").select("id", { count: "exact", head: true }).eq("run_id", run.id);
      await admin.from("runs").update({
        total_comments: count ?? 0,
        last_refreshed_at: new Date().toISOString(),
      }).eq("id", run.id);
    } catch (e) {
      status = "error";
      detail = (e as Error).message ?? String(e);
    }

    await admin.from("refresh_log").insert({
      run_id: run.id, user_id: run.user_id,
      new_comments: added, status, detail,
    });
    summary.push({ run: run.name, added, status, detail });
  }

  return json({ ok: true, runs: runs.length, elapsed_ms: Date.now() - t0, summary }, 200);
});
