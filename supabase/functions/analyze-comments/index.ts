import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

/**
 * Classifies YouTube comments: sentiment, category (lead / question /
 * complaint / ...), and a short theme label.
 *
 * Two providers:
 *   anthropic  - the Anthropic SDK directly (default, needs ANTHROPIC_API_KEY)
 *   openrouter - any of ~340 other models, free and paid (needs OPENROUTER_API_KEY)
 *
 * The OpenRouter catalogue is fetched live rather than hard-coded, so new
 * model releases appear without redeploying. Ranking is a curated,
 * family-level heuristic - new minor versions inherit their family's rank.
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
const ANTHROPIC_PRICE_IN = 5.0;   // USD per million tokens
const ANTHROPIC_PRICE_OUT = 25.0;

const MAX_BATCH = 40;
const MAX_COMMENT_CHARS = 500;
type Effort = "low" | "medium" | "high";
const VALID_EFFORT: Effort[] = ["low", "medium", "high"];
const toEffort = (v: unknown): Effort =>
  VALID_EFFORT.includes(v as Effort) ? (v as Effort) : "medium";

/** Curated capability order, best first. Matched against the model id, so a
 *  newer point release inside a family keeps its family's rank. */
const RANK: RegExp[] = [
  /^anthropic\/claude-fable/,
  /^anthropic\/claude-opus-4\.8(?!-fast)/,
  /^openai\/gpt-5\.6-sol-pro/,
  /^openai\/gpt-5\.5-pro/,
  /^openai\/gpt-5\.6-sol/,
  /^google\/gemini-3\.6/,
  /^x-ai\/grok-4\.5/,
  /^anthropic\/claude-sonnet-5/,
  /^openai\/gpt-5\.6-terra/,
  /^deepseek\/deepseek-v4-pro/,
  /^qwen\/qwen3\.7-max/,
  /^mistralai\/mistral-large/,
  /^meta-llama\/llama-4-maverick/,
];

function rankOf(id: string): number {
  for (let i = 0; i < RANK.length; i++) if (RANK[i].test(id)) return i;
  return RANK.length + 50;
}

const SYSTEM = `You classify comments left on a YouTube channel that publishes Indian farming and agriculture content. Comments are often in Hindi, English, or mixed Hinglish, and may be transliterated.

For each comment assign:

sentiment - how the commenter feels about the channel or the content:
  positive | neutral | negative

category - what the comment IS, choosing the single best fit:
  lead      - shows buying or enrolment intent: asking price, availability, how to
              order, how to join a course, requesting contact, sharing a phone number
  question  - a genuine question about farming, technique, or the content, with no
              buying intent
  complaint - dissatisfaction: a problem with a product, service, order, or a
              substantive criticism of the content
  praise    - appreciation or thanks with no question attached
  spam      - promotion of an unrelated product, link-dropping, or gibberish
  other     - anything that fits none of the above

theme - a short lowercase topic label of at most three words describing the subject
  matter (for example "drip irrigation", "seed price", "course enrolment", "tractor
  maintenance"). Reuse the same wording for the same topic so themes group together.

Judge sentiment on the commenter's attitude, not the topic: a polite question about
a crop disease is neutral, not negative. Classify what the comment actually says --
do not infer intent that is not there.

Return a JSON object of the form {"results": [{"i": <index>, "sentiment": ..., "category": ..., "theme": ...}]} with exactly one entry per comment index. Return JSON only, with no surrounding prose or code fences.`;

const SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer", description: "The index shown for this comment." },
          sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
          category: {
            type: "string",
            enum: ["lead", "question", "complaint", "praise", "spam", "other"],
          },
          theme: { type: "string", description: "At most three lowercase words." },
        },
        required: ["i", "sentiment", "category", "theme"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

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

/** Models sometimes wrap JSON in prose or a code fence despite instructions. */
function parseLooseJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first === -1 || last <= first) throw new Error("Model output was not valid JSON.");
    return JSON.parse(text.slice(first, last + 1));
  }
}

// --- OpenRouter catalogue, cached per isolate ---
type OrModel = {
  id: string; name: string; context_length: number;
  priceIn: number; priceOut: number; free: boolean;
  structured: boolean; rank: number;
};
let catalogue: { at: number; models: OrModel[] } | null = null;
const CATALOGUE_TTL_MS = 10 * 60 * 1000;

async function loadCatalogue(): Promise<OrModel[]> {
  if (catalogue && Date.now() - catalogue.at < CATALOGUE_TTL_MS) return catalogue.models;
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error("Could not reach the OpenRouter model catalogue.");
  const body = await res.json();
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n * 1e6 : 0;
  };
  const models: OrModel[] = (body.data ?? [])
    .filter((m: Record<string, any>) => {
      // Text-in, text-only-out. The catalogue also carries image and audio
      // models; several of those list "text" alongside "image"/"audio", so an
      // includes("text") check would let them through.
      const out = m.architecture?.output_modalities ?? ["text"];
      const inp = m.architecture?.input_modalities ?? ["text"];
      return out.length > 0 && out.every((x: string) => x === "text") && inp.includes("text");
    })
    .map((m: Record<string, any>) => {
      const priceIn = num(m.pricing?.prompt);
      const priceOut = num(m.pricing?.completion);
      return {
        id: m.id,
        name: m.name ?? m.id,
        context_length: m.context_length ?? 0,
        priceIn, priceOut,
        free: priceIn === 0 && priceOut === 0,
        structured: (m.supported_parameters ?? []).includes("structured_outputs"),
        rank: rankOf(m.id),
      };
    })
    // Curated rank first; within the same rank, dearer usually means more capable.
    .sort((a: OrModel, b: OrModel) => a.rank - b.rank || b.priceIn - a.priceIn);
  catalogue = { at: Date.now(), models };
  return models;
}

async function callAnthropic(apiKey: string, prompt: string, effort: Effort) {
  const client = new Anthropic({ apiKey });
  // Thinking is off and effort is capped: this is high-volume bucket
  // classification over short texts. Raise effort if accuracy matters more.
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    thinking: { type: "disabled" },
    output_config: { effort, format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to classify this batch.");
  }
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Model returned no text block.");
  const usage = response.usage;
  return {
    parsed: parseLooseJson(block.text) as { results?: unknown[] },
    inTok: usage.input_tokens,
    outTok: usage.output_tokens,
    cost: (usage.input_tokens / 1e6) * ANTHROPIC_PRICE_IN +
          (usage.output_tokens / 1e6) * ANTHROPIC_PRICE_OUT,
    model: response.model,
  };
}

async function callOpenRouter(apiKey: string, modelId: string, prompt: string) {
  const models = await loadCatalogue();
  const meta = models.find((m) => m.id === modelId);
  if (!meta) throw new Error(`Unknown model: ${modelId}`);

  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: 8000,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ],
  };
  // Only ask for a strict schema where the model advertises support; the rest
  // are held to the JSON instruction in the system prompt and parsed loosely.
  if (meta.structured) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "classifications", strict: true, schema: SCHEMA },
    };
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://digitalpritam1.github.io/youtube-comment-dashboard/",
      "X-Title": "YouTube Comment Dashboard",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `OpenRouter returned ${res.status}.`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Model returned an empty response.");
  }
  const inTok = data?.usage?.prompt_tokens ?? 0;
  const outTok = data?.usage?.completion_tokens ?? 0;
  return {
    parsed: parseLooseJson(content) as { results?: unknown[] },
    inTok, outTok,
    cost: (inTok / 1e6) * meta.priceIn + (outTok / 1e6) * meta.priceOut,
    model: modelId,
  };
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

  // --- may they spend the shared keys? ---
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: allowed } = await admin
    .from("allowed_emails").select("email").eq("email", email).maybeSingle();
  if (!allowed) {
    return json({
      error: { message: "This account is not approved for analysis. Ask the owner to add " + email + "." },
    }, 403, origin);
  }

  let payload: {
    action?: string;
    comments?: { text?: string }[];
    provider?: string;
    model?: string;
    effort?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: { message: "Body must be JSON." } }, 400, origin);
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");

  // --- model catalogue ---
  if (payload.action === "list_models") {
    const out: Record<string, unknown> = {
      anthropic_ready: !!anthropicKey,
      openrouter_ready: !!openrouterKey,
      anthropic: {
        id: ANTHROPIC_MODEL, provider: "anthropic",
        name: "Claude Opus 4.8 (direct)",
        priceIn: ANTHROPIC_PRICE_IN, priceOut: ANTHROPIC_PRICE_OUT,
        free: false, structured: true,
      },
      models: [],
    };
    if (openrouterKey) {
      try {
        out.models = await loadCatalogue();
      } catch (e) {
        out.catalogue_error = (e as Error).message;
      }
    }
    return json(out, 200, origin);
  }

  // --- classify ---
  const comments = Array.isArray(payload.comments) ? payload.comments : [];
  if (!comments.length) {
    return json({ error: { message: "No comments supplied." } }, 400, origin);
  }
  if (comments.length > MAX_BATCH) {
    return json({ error: { message: `Send at most ${MAX_BATCH} comments per request.` } }, 400, origin);
  }

  const provider = payload.provider === "openrouter" ? "openrouter" : "anthropic";
  const effort = toEffort(payload.effort);

  if (provider === "anthropic" && !anthropicKey) {
    return json({
      error: {
        message: "Server has no ANTHROPIC_API_KEY configured. Set it in Supabase " +
                 "(Edge Functions -> Secrets), or pick an OpenRouter model instead.",
      },
    }, 503, origin);
  }
  if (provider === "openrouter" && !openrouterKey) {
    return json({
      error: {
        message: "Server has no OPENROUTER_API_KEY configured. Set it in Supabase " +
                 "(Edge Functions -> Secrets) to use non-Anthropic models.",
      },
    }, 503, origin);
  }

  // Index every comment so output maps back unambiguously even if the model
  // reorders rows or drops one.
  const prompt = `Classify each of these ${comments.length} comments. Return one result per index.\n\n` +
    comments
      .map((c, i) => `[${i}] ${String(c.text ?? "").slice(0, MAX_COMMENT_CHARS).replace(/\s+/g, " ").trim()}`)
      .join("\n");

  try {
    const r = provider === "anthropic"
      ? await callAnthropic(anthropicKey!, prompt, effort)
      : await callOpenRouter(openrouterKey!, String(payload.model ?? ""), prompt);

    return json({
      results: r.parsed?.results ?? [],
      usage: {
        input_tokens: r.inTok,
        output_tokens: r.outTok,
        cost_usd: Number(r.cost.toFixed(6)),
      },
      provider,
      model: r.model,
    }, 200, origin);
  } catch (e) {
    const status = (e as { status?: number }).status;
    const message = (e as { message?: string }).message ?? "Analysis failed.";
    return json({ error: { message } }, status && status >= 400 && status < 600 ? status : 502, origin);
  }
});
