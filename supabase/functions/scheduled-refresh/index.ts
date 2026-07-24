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
  id: string; user_id: string; name: string;
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  // Only the cron job may call this. The service-role key is compared against
  // this function's own environment, so no additional secret is needed.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!serviceKey || token !== serviceKey) {
    return json({ error: "Not authorised." }, 401);
  }

  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (!apiKey) return json({ error: "YOUTUBE_API_KEY is not configured." }, 503);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const t0 = started();

  const { data: runs, error } = await admin
    .from("runs")
    .select("id,user_id,name,source_type,source_value")
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

      const videos = await listVideos(run, apiKey);
      const fresh: NewComment[] = [];

      for (const v of videos) {
        if (Date.now() - t0 > DEADLINE_MS) {
          status = "partial";
          detail = `Stopped on the time budget after ${fresh.length} new comment(s).`;
          break;
        }
        const r = await commentsSince(v, cutoffMs, apiKey);
        fresh.push(...r.rows);
        if (r.fatal) { status = "partial"; detail = "YouTube quota exhausted."; break; }
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
