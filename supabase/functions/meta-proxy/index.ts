import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Proxies Meta Graph API (Facebook + Instagram) reads so a shared Page token
 * never reaches the browser. Callers must be signed in AND listed in
 * public.allowed_emails.
 *
 * Only the owner's own Page + connected Instagram account are reachable — that
 * is all Meta's official API supports. The token is a never-expiring System
 * User token, held server-side as META_PAGE_TOKEN with META_PAGE_ID naming the
 * Page.
 *
 * verify_jwt is disabled at the gateway on purpose: it would reject the
 * browser's CORS preflight, which by spec carries no Authorization header.
 * The JWT is verified in-function, below, for every non-OPTIONS request.
 */

const GRAPH = "https://graph.facebook.com/v21.0/";

const ALLOWED_ORIGINS = [
  "https://digitalpritam1.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
];

// A Graph path is either a bare node ("{id}" / "me") or "{id}/{edge}". Only
// these read edges are permitted, so the proxy can't be repurposed to reach
// arbitrary Graph endpoints (e.g. publishing, messaging).
const ALLOWED_EDGES = new Set(["posts", "feed", "comments", "media", "insights"]);

function endpointOk(ep: string): boolean {
  const clean = ep.replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_.\/]+$/.test(clean)) return false;
  const parts = clean.split("/");
  if (parts.length === 1) return true;          // node lookup: "{id}" or "me"
  if (parts.length === 2) return ALLOWED_EDGES.has(parts[1]);
  return false;
}

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

/**
 * A System User token is a *user*-context token. Facebook's Page content edges
 * (/{page}/posts, /{page}/feed, /{post}/comments) and the linked Instagram
 * account must be read with the *Page* access token, which is derived from the
 * user-context token. Exchange the stored token for the Page token once; if the
 * stored value is already a Page token, or the exchange isn't permitted, fall
 * back to it unchanged. The Page token stays server-side, exactly like the seed.
 */
async function resolvePageToken(pageId: string, seed: string): Promise<string> {
  try {
    const r = await fetch(
      `${GRAPH}${pageId}?fields=access_token&access_token=${encodeURIComponent(seed)}`,
    );
    const d = await r.json();
    if (r.ok && typeof d?.access_token === "string" && d.access_token) return d.access_token;
  } catch { /* fall through to the seed token */ }
  return seed;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: { message: "Use POST." } }, 405, origin);
  }

  // --- who is calling ---
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: { message: "Sign in required." } }, 401, origin);

  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data: userData, error: authError } = await anon.auth.getUser(token);
  if (authError || !userData?.user) {
    return json({ error: { message: "Invalid or expired session." } }, 401, origin);
  }
  const email = (userData.user.email ?? "").toLowerCase();

  // --- may they spend the shared token? ---
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: allowed } = await admin
    .from("allowed_emails").select("email").eq("email", email).maybeSingle();
  if (!allowed) {
    return json({
      error: {
        message: "This account is not approved for the shared Meta token. " +
                 "Switch to 'Use my own token', or ask the owner to add " + email + ".",
      },
    }, 403, origin);
  }

  const pageToken = Deno.env.get("META_PAGE_TOKEN");
  const pageId = Deno.env.get("META_PAGE_ID");
  if (!pageToken || !pageId) {
    return json({
      error: {
        message: "Server has no META_PAGE_TOKEN / META_PAGE_ID configured. Set them in " +
                 "Supabase (Edge Functions -> Secrets), or switch the dashboard to 'Use my own token'.",
      },
    }, 503, origin);
  }

  let payload: {
    action?: string; endpoint?: string;
    params?: Record<string, string>; page_id?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: { message: "Body must be JSON." } }, 400, origin);
  }

  // --- list every Page this System User token manages (for the picker) ---
  // Uses the seed (user-context) token; /me/accounts needs it, not a Page token.
  // No Page access tokens are returned to the browser.
  if (payload.action === "pages") {
    try {
      const out: {
        page_id: string; page_name: string;
        ig_user_id: string | null; ig_username: string | null;
      }[] = [];
      let next: string | null =
        `${GRAPH}me/accounts?fields=id,name,instagram_business_account{id,username}` +
        `&limit=100&access_token=${encodeURIComponent(pageToken)}`;
      while (next && out.length < 200) {
        const r = await fetch(next);
        const d: any = await r.json();
        if (!r.ok) throw new Error(d?.error?.message || "Could not list Pages.");
        for (const p of (d.data ?? []) as any[]) {
          out.push({
            page_id: p.id,
            page_name: p.name ?? p.id,
            ig_user_id: p.instagram_business_account?.id ?? null,
            ig_username: p.instagram_business_account?.username ?? null,
          });
        }
        next = d.paging?.next ?? null;   // paging URLs already carry the token
      }
      return json({ pages: out }, 200, origin);
    } catch (e) {
      return json({ error: { message: (e as Error).message } }, 502, origin);
    }
  }

  // Which Page are we acting on? Default to the configured one; the picker sends
  // an explicit page_id for any other Page assigned to the System User.
  const targetPageId = (typeof payload.page_id === "string" && /^\d+$/.test(payload.page_id))
    ? payload.page_id
    : pageId;

  // Content edges need the *Page* token, exchanged from the stored System User
  // token. (No-op if the stored token is already a Page token.)
  const graphToken = await resolvePageToken(targetPageId, pageToken);

  // --- resolve the target Page's id + linked Instagram id (one round trip) ---
  if (payload.action === "ids") {
    try {
      const r = await fetch(
        `${GRAPH}${targetPageId}?fields=instagram_business_account,name&access_token=${encodeURIComponent(graphToken)}`,
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message || "Could not read the Page.");
      return json({
        page_id: targetPageId,
        page_name: data?.name ?? null,
        ig_user_id: data?.instagram_business_account?.id ?? null,
      }, 200, origin);
    } catch (e) {
      return json({ error: { message: (e as Error).message } }, 502, origin);
    }
  }

  // --- generic proxied read ---
  const endpoint = String(payload.endpoint ?? "");
  if (!endpointOk(endpoint)) {
    return json({ error: { message: `Endpoint not allowed: ${endpoint}` } }, 400, origin);
  }

  const url = new URL(GRAPH + endpoint.replace(/^\/+/, ""));
  for (const [k, v] of Object.entries(payload.params ?? {})) {
    // access_token is injected below; never let the caller set it.
    if (k !== "access_token" && v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }
  url.searchParams.set("access_token", graphToken);

  const upstream = await fetch(url.toString());
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
});
