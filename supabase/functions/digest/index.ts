import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

/**
 * Turns an already-classified comment set into a short written brief:
 * what people are asking for, which leads to chase, what is going wrong.
 *
 * Kept separate from analyze-comments on purpose - that function runs once per
 * 40-comment batch, this one runs once per report, and they have different
 * shapes and failure modes.
 *
 * verify_jwt is disabled at the gateway on purpose - it would reject the
 * browser's CORS preflight, which by spec carries no Authorization header.
 * The JWT is verified in-function for every non-OPTIONS request.
 */

const ALLOWED_ORIGINS = [
  "https://digitalpritam1.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
];

const ANTHROPIC_MODEL = "claude-opus-4-8";
const ANTHROPIC_PRICE_IN = 5.0;
const ANTHROPIC_PRICE_OUT = 25.0;

// Caps on what gets quoted into the prompt, so one call stays cheap and bounded
// no matter how large the run is.
const MAX_QUOTED = 30;
const MAX_CHARS = 300;

const SYSTEM = `You write a short, practical brief for the owner of an Indian farming YouTube channel, based on comments that have already been classified by sentiment, category, and theme. Comments may be in Hindi, English, or mixed Hinglish.

Write in Markdown with exactly these sections, in this order:

## Summary
Two or three sentences on the overall picture: how the audience is responding and what stands out this period.

## Leads to follow up
The specific commenters showing buying or enrolment intent. For each, give the author name, what they want, and quote the useful fragment. If a comment contains a phone number or contact detail, say so - do not reproduce the digits. If there are none, say so plainly.

## Complaints and problems
Group the complaints by what actually went wrong, biggest group first. Give counts. If there are none, say so plainly.

## Questions worth answering
The questions that came up repeatedly, or that would make good content. Group similar questions rather than listing every one.

## Suggested actions
Three to five concrete next steps, ordered by value. Be specific to what the comments say - no generic channel-growth advice.

Rules: base every claim on the supplied data. Do not invent numbers, names, or quotes. If a section has nothing in it, write one short line saying so rather than padding. Keep the whole brief under 500 words. Write plainly, for a busy reader.`;

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

type Comment = {
  author?: string; text?: string; video_title?: string;
  sentiment?: string; category?: string; theme?: string; likes?: number;
};

/** Builds the prompt from counts plus a bounded, most-liked-first sample. */
function buildPrompt(comments: Comment[], label: string): string {
  const analysed = comments.filter((c) => c.sentiment);
  const count = (fn: (c: Comment) => boolean) => analysed.filter(fn).length;

  const themes: Record<string, number> = {};
  analysed.forEach((c) => {
    if (c.theme) themes[c.theme] = (themes[c.theme] ?? 0) + 1;
  });
  const topThemes = Object.entries(themes)
    .sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([t, n]) => `${t} (${n})`).join(", ") || "none";

  // Most-liked first: if the sample has to be cut, keep what the audience
  // engaged with most rather than an arbitrary slice.
  const pick = (cat: string) =>
    analysed
      .filter((c) => c.category === cat)
      .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
      .slice(0, MAX_QUOTED)
      .map((c) =>
        `- [${c.author || "unknown"}] ${String(c.text ?? "").slice(0, MAX_CHARS).replace(/\s+/g, " ").trim()}`)
      .join("\n") || "(none)";

  const totalLeads = count((c) => c.category === "lead");
  const totalComplaints = count((c) => c.category === "complaint");
  const totalQuestions = count((c) => c.category === "question");

  return `Source: ${label}

Totals
- comments analysed: ${analysed.length}
- positive: ${count((c) => c.sentiment === "positive")}
- neutral: ${count((c) => c.sentiment === "neutral")}
- negative: ${count((c) => c.sentiment === "negative")}
- leads: ${totalLeads}
- questions: ${totalQuestions}
- complaints: ${totalComplaints}
- praise: ${count((c) => c.category === "praise")}
- spam: ${count((c) => c.category === "spam")}

Top themes: ${topThemes}

Leads (showing up to ${MAX_QUOTED} of ${totalLeads}, most-liked first)
${pick("lead")}

Complaints (showing up to ${MAX_QUOTED} of ${totalComplaints}, most-liked first)
${pick("complaint")}

Questions (showing up to ${MAX_QUOTED} of ${totalQuestions}, most-liked first)
${pick("question")}`;
}

async function viaAnthropic(apiKey: string, prompt: string) {
  const client = new Anthropic({ apiKey });
  // Adaptive thinking here: this is a judgement task over mixed evidence, not
  // the bucket classification that analyze-comments runs.
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to write this brief.");
  const text = response.content.filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text).join("\n").trim();
  if (!text) throw new Error("Model returned no text.");
  const u = response.usage;
  return {
    text,
    cost: (u.input_tokens / 1e6) * ANTHROPIC_PRICE_IN + (u.output_tokens / 1e6) * ANTHROPIC_PRICE_OUT,
    model: response.model,
  };
}

async function viaOpenRouter(apiKey: string, modelId: string, prompt: string) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://digitalpritam1.github.io/youtube-comment-dashboard/",
      "X-Title": "YouTube Comment Dashboard",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 4000,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `OpenRouter returned ${res.status}.`);
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("Model returned an empty response.");

  // Price the call from the live catalogue rather than a hard-coded table.
  let cost = 0;
  try {
    const cat = await fetch("https://openrouter.ai/api/v1/models").then((r) => r.json());
    const m = (cat.data ?? []).find((x: Record<string, any>) => x.id === modelId);
    const inP = Number(m?.pricing?.prompt ?? 0) * 1e6;
    const outP = Number(m?.pricing?.completion ?? 0) * 1e6;
    cost = ((data?.usage?.prompt_tokens ?? 0) / 1e6) * inP +
           ((data?.usage?.completion_tokens ?? 0) / 1e6) * outP;
  } catch { /* cost is informational; a pricing lookup failure must not fail the brief */ }

  return { text: text.trim(), cost, model: modelId };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") return json({ error: { message: "Use POST." } }, 405, origin);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: { message: "Sign in required." } }, 401, origin);

  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: userData, error: authError } = await anon.auth.getUser(token);
  if (authError || !userData?.user) {
    return json({ error: { message: "Invalid or expired session." } }, 401, origin);
  }
  const email = (userData.user.email ?? "").toLowerCase();

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: allowed } = await admin
    .from("allowed_emails").select("email").eq("email", email).maybeSingle();
  if (!allowed) {
    return json({
      error: { message: "This account is not approved. Ask the owner to add " + email + "." },
    }, 403, origin);
  }

  let payload: { comments?: Comment[]; label?: string; provider?: string; model?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: { message: "Body must be JSON." } }, 400, origin);
  }

  const comments = Array.isArray(payload.comments) ? payload.comments : [];
  const analysed = comments.filter((c) => c.sentiment);
  if (!analysed.length) {
    return json({ error: { message: "Analyse the comments first — there is nothing to summarise." } }, 400, origin);
  }

  const provider = payload.provider === "openrouter" ? "openrouter" : "anthropic";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");

  if (provider === "anthropic" && !anthropicKey) {
    return json({
      error: { message: "Server has no ANTHROPIC_API_KEY configured. Set it in Supabase (Edge Functions -> Secrets), or pick an OpenRouter model." },
    }, 503, origin);
  }
  if (provider === "openrouter" && !openrouterKey) {
    return json({
      error: { message: "Server has no OPENROUTER_API_KEY configured. Set it in Supabase (Edge Functions -> Secrets)." },
    }, 503, origin);
  }

  const prompt = buildPrompt(analysed, String(payload.label ?? "this run"));

  try {
    const r = provider === "anthropic"
      ? await viaAnthropic(anthropicKey!, prompt)
      : await viaOpenRouter(openrouterKey!, String(payload.model ?? ""), prompt);
    return json({
      digest: r.text,
      cost_usd: Number(r.cost.toFixed(6)),
      model: r.model,
      provider,
      based_on: analysed.length,
    }, 200, origin);
  } catch (e) {
    const status = (e as { status?: number }).status;
    const message = (e as { message?: string }).message ?? "Digest failed.";
    return json({ error: { message } }, status && status >= 400 && status < 600 ? status : 502, origin);
  }
});
