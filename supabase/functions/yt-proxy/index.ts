import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Proxies YouTube Data API v3 calls so a shared API key never reaches the
 * browser. Callers must be signed in AND listed in public.allowed_emails.
 *
 * verify_jwt is disabled at the gateway on purpose: the gateway would reject
 * the browser's CORS preflight, which by spec carries no Authorization header.
 * The JWT is instead verified in-function, below, for every non-OPTIONS request.
 */

const ALLOWED_ORIGINS = [
  "https://digitalpritam1.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
];

// Only the endpoints this dashboard actually uses. Prevents the proxy from
// being repurposed to hit arbitrary Google APIs.
const ALLOWED_ENDPOINTS = new Set([
  "channels",
  "playlistItems",
  "commentThreads",
  "videos",
  "search",
]);

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

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: { message: "Use POST." } }, 405, origin);
  }

  // --- who is calling ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return json({ error: { message: "Sign in required." } }, 401, origin);
  }

  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data: userData, error: authError } = await anon.auth.getUser(token);
  if (authError || !userData?.user) {
    return json({ error: { message: "Invalid or expired session." } }, 401, origin);
  }
  const email = (userData.user.email ?? "").toLowerCase();

  // --- may they spend the shared key? ---
  // Service role: allowed_emails has RLS on with no policies, so it is
  // deliberately unreachable from the browser.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: allowed } = await admin
    .from("allowed_emails").select("email").eq("email", email).maybeSingle();

  if (!allowed) {
    return json({
      error: {
        message:
          "This account is not approved for the shared key. " +
          "Switch to 'Use my own key', or ask the owner to add " + email + ".",
      },
    }, 403, origin);
  }

  // --- the shared key, set by the project owner ---
  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (!apiKey) {
    return json({
      error: {
        message:
          "Server has no YOUTUBE_API_KEY configured. Set it in Supabase " +
          "(Edge Functions -> Secrets), or switch the dashboard to 'Use my own key'.",
      },
    }, 503, origin);
  }

  // --- proxy ---
  let payload: { endpoint?: string; params?: Record<string, string> };
  try {
    payload = await req.json();
  } catch {
    return json({ error: { message: "Body must be JSON." } }, 400, origin);
  }

  const endpoint = String(payload.endpoint ?? "");
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return json({ error: { message: `Endpoint not allowed: ${endpoint}` } }, 400, origin);
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/" + endpoint);
  for (const [k, v] of Object.entries(payload.params ?? {})) {
    if (k !== "key" && v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }
  url.searchParams.set("key", apiKey);

  const upstream = await fetch(url.toString());
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
});
