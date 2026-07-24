# YouTube Comment Dashboard

A client-side dashboard for extracting and exploring comments (and replies) from
YouTube, using the YouTube Data API v3. Runs entirely in the browser — no server,
no build step.

**Live site:** https://digitalpritam1.github.io/youtube-comment-dashboard/

## Contents

- `index.html` — the dashboard (single file, no build step).
- `youtube_comment_extractor.py` — command-line version that exports a whole
  channel's comments to CSV, for scheduled/automated runs.
- `supabase/functions/` — the deployed edge functions, kept here for review and
  history. They are deployed to the Supabase project, not from this repo.

## Features

**Input** — paste almost anything:

| Input | Example |
|---|---|
| Handle | `@IndianFarmerOfficial` |
| Channel ID or URL | `UCxxxx…`, `youtube.com/channel/UCxxxx…`, `youtube.com/@handle` |
| Video URL or ID | `youtube.com/watch?v=…`, `youtu.be/…`, `/shorts/…`, `/embed/…`, bare 11-char ID |
| Playlist URL | `youtube.com/playlist?list=…` |
| Channel name | `Indian Farmer` (falls back to search) |

A watch URL that also carries `&list=` is treated as a **playlist** — paste the
plain `watch?v=` form if you want just the one video.

**Saved runs** — extractions are stored in IndexedDB on your device. The 10 most
recent are kept; each can be named, reopened without re-fetching, renamed, or
deleted. Useful for tracking a video's comments over time.

**Incremental refresh** — **Refresh** on a saved run fetches only comments newer
than the newest one it already holds. Results come back newest-first, so the fetch
stops paging a video as soon as it reaches a comment older than the cutoff —
typically **one quota unit per video** instead of one per 100 comments. New
comments are merged and deduplicated on YouTube's own comment id.

*Caveat:* the early stop is based on top-level comment dates, so a **new reply on
an older thread** is not picked up. Re-fetch the source from the top when that
matters.

**Export** — CSV, JSON, and Excel (`.xlsx`, with column widths, a frozen header
row, and autofilter). Files are named after the source — the video's own title
for a single video, otherwise the channel or playlist name (e.g.
`IndianFarmerOfficial_comments.csv`). Non-Latin titles are kept intact, so a
Marathi video exports as `खरीप_पीक_विमा…_comments.csv`.

**Resilience** — a video with comments disabled is skipped and counted. If the
API quota runs out mid-run, the fetch stops but *keeps everything already
pulled*, so a long extraction is never thrown away.

**Other** — dark/light/auto theme toggle (remembered), mobile-responsive table,
and the API key is remembered on the device.

## Using the dashboard

1. Open the live site.
2. Get a YouTube Data API v3 key from the
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   (enable "YouTube Data API v3" on your project first).
3. Paste the key and a source, then fetch.

Your API key is stored in this browser's `localStorage` and is only ever sent to
Google's API. Because it is a single-user client-side tool, the key *is* readable
by anything running in this browser — use an API-restricted key, and don't use
this page on a shared machine.

## Quota notes

The YouTube Data API gives 10,000 units/day by default.

- Listing videos uses `playlistItems.list` — **1 unit** per 50 videos.
- Fetching comments uses `commentThreads.list` — **1 unit** per 100 comments.
- A **Refresh** costs roughly 1 unit per video regardless of how many comments
  that video has, because paging stops at the cutoff.
- Resolving a channel by *name* falls back to `search.list` — **100 units**.
  Paste a handle or channel ID instead to avoid this.

## Using the Python extractor

```bash
pip install google-api-python-client
python youtube_comment_extractor.py --channel @IndianFarmerOfficial --api_key YOUR_KEY
```

## Cloud mode (optional)

Signing in is **optional** — signed out, the dashboard works exactly as before and
saves runs to this browser only. Signing in adds:

- **Cross-device history** — runs stored in Postgres, not just this browser.
- **A shared server-side key** — the YouTube key lives in an edge function, so it
  is never exposed to the browser.
- **Upload** — a button to copy this device's local runs into your account.

Sign-in is a **magic link** (no passwords). Backend: Supabase project
`youtube-comment-dashboard` (`aycfiqndcavzgipgurih`, region `ap-south-1`).

### Setup the owner must do

**1. Set the shared keys.** In the Supabase dashboard → *Edge Functions →
Secrets*, add:

- `YOUTUBE_API_KEY` — your YouTube Data API v3 key. Until this is set, the proxy
  returns a clear 503 and "use my own key" still works.
- `ANTHROPIC_API_KEY` — your Anthropic API key, for comment analysis on Claude.
  Until this is set, the Analyse button returns a clear 503 and everything else
  still works.
- `OPENROUTER_API_KEY` *(optional)* — unlocks the other ~330 models, free and
  paid, in the model dropdown. Without it only the Anthropic option appears.

**2. Approve who may use them.** The dashboard is on a public URL, so anyone can
create an account. Their own data stays isolated by row-level security, but only
allowlisted addresses may spend the shared YouTube or Anthropic keys:

```sql
insert into public.allowed_emails (email, note) values ('teammate@example.com', 'why');
```

`pritam@indianfarmer.com` is already listed.

**3. Email delivery.** Supabase's built-in SMTP is rate-limited to a handful of
messages per hour — fine for one person, not for a team. Configure custom SMTP
under *Authentication → Emails* before more than one or two people rely on it.

## Scheduled refresh (nightly)

Tick **refresh nightly** on a cloud run and the server pulls new comments for it
every night at **02:30 IST (21:00 UTC)** — no browser open, no one at the keyboard.
It reuses the same incremental cutoff, so a nightly run costs about one quota unit
per video.

Pieces: `pg_cron` fires `pg_net`, which POSTs to the `scheduled-refresh` edge
function. That function authenticates by comparing the bearer token against its own
`SUPABASE_SERVICE_ROLE_KEY` — so there is **no extra secret to invent**; the cron job
reads the same key out of Supabase Vault at fire time rather than storing it in the
job body. Every attempt writes a row to `refresh_log` (new comment count, status,
error detail), so a silent 2am failure is visible the next morning.

Comments are inserted with `upsert ... ignoreDuplicates` against the
`(run_id, comment_id)` unique index, so a re-run can never double-insert. The
function has a 100-second budget and records a `partial` status if it runs out of
time or hits the YouTube quota, rather than being killed mid-insert.

### One-time setup for the schedule

The cron job is already scheduled, but it needs the service-role key in Vault
before it can authenticate. Run this **once** in the Supabase SQL editor, pasting
your own service-role key (Project Settings → API):

```sql
select vault.create_secret('<your-service-role-key>', 'service_role_key');
```

Until that exists the nightly job runs and fails harmlessly. Check on it with:

```sql
select * from cron.job_run_details order by start_time desc limit 5;
select * from public.refresh_log order by ran_at desc limit 20;
```

Analysis is **not** run automatically — new comments arrive tagged as unanalysed
and you classify them on the next visit. Auto-analysis and emailing the brief are
the natural next step.

## Comment analysis

Signed-in users can run a **model pass** over the extracted comments — Claude by
default, or any of ~330 other models. Each comment is tagged with:

- **Sentiment** — positive / neutral / negative, judged on the commenter's attitude
  rather than the topic (a polite question about crop disease is neutral, not negative).
- **Category** — `lead` (buying or enrolment intent), `question`, `complaint`,
  `praise`, `spam`, `other`.
- **Theme** — a short topic label, reused across comments so themes group together.

The dashboard then shows a sentiment bar, the top themes by volume, and clickable
category chips that filter the table — so "show me every lead" is one click. Tags
also appear inline in the table, and all three fields are included in the CSV, JSON,
and Excel exports.

The prompt is written for **Hindi, English, and mixed Hinglish** comments, since
that's what an Indian farming channel actually gets.

### The brief

Once comments are analysed, **Write a brief** produces a short Markdown report:
a summary, the specific leads worth following up (with the commenter's name and
the useful fragment quoted), complaints grouped by what actually went wrong,
recurring questions, and three to five concrete next steps. There's a Copy button
for pasting it into email or WhatsApp.

The prompt sends counts and themes for the whole set, plus up to 30 quoted
examples per category chosen **most-liked first** — so if the sample has to be
trimmed, what survives is what the audience actually engaged with. It is
instructed never to reproduce phone numbers, only to flag that a comment contains
one. Model output is HTML-escaped before rendering, so nothing it returns can
inject markup into the page.

### Choosing a model

A dropdown lists models **best first**, in three groups:

| Group | What's in it |
|---|---|
| **Recommended** | Claude Opus 4.8 direct, then a curated capability order across Anthropic, OpenAI, Google, xAI, DeepSeek, Qwen, Mistral, and Meta |
| **Free** | Every zero-cost model OpenRouter currently offers |
| **All other paid models** | The remaining ~300, sorted by price as a rough capability proxy |

Two routes are supported:

- **Anthropic direct** (default) — `claude-opus-4-8` through the Anthropic SDK.
- **OpenRouter** — everything else, via one key.

The catalogue is **fetched live** from OpenRouter on each session rather than
hard-coded, so newly released models appear without redeploying. Ranking is a
curated *family-level* heuristic, so a new point release inherits its family's
position. Ordering is a judgement call, not a benchmark — treat it as a starting
point.

Models that advertise strict JSON schema support get a hard-enforced schema; the
rest (77 of ~330 at time of writing) are held to a JSON instruction in the prompt
and parsed leniently, tolerating code fences and surrounding prose. The dropdown
labels which is which, and warns on free-tier rate limits.

**Cost.** Each model's real per-token price comes from the live catalogue, and the
dashboard reports actual spend after each run. Claude Opus 4.8 is $5/$25 per
million input/output tokens; free models cost nothing but expect rate limits and
lower accuracy. Comments are sent in batches of 40; already-analysed comments are
skipped, so re-running after a failure resumes rather than paying twice.

### Data model

| Table | Purpose |
|---|---|
| `runs` | One row per saved extraction (name, source, totals, per-video stats) |
| `comments` | One row per comment, `run_id` FK with cascade delete. Analysis results (`sentiment`, `category`, `theme`, `analyzed_at`) live here too, so sentiment can be compared across runs over time |
| `allowed_emails` | Who may use the shared keys. RLS on, no policies — unreachable from the browser by design |

Both `runs` and `comments` are protected by RLS: every policy filters on
`user_id = auth.uid()`, so one account can never read or modify another's rows.

## Caveats

- **Free-tier projects pause after ~7 days of inactivity** and need a manual
  unpause in the Supabase dashboard. If the tool is used only occasionally, the
  signed-out local mode is the more reliable default.
- Cloud runs are **not** pruned to 10 the way local runs are — accumulating
  history is the point of the database.
- Excel export uses SheetJS's community build: column widths, freeze panes, and
  autofilter work, but cell styling (fonts, fills, colours) is a paid feature.

## Roadmap

Still to build:

- Auto-analysis of nightly-arrived comments, and emailing the brief (needs an
  email provider key such as Resend)
- Google Sheets direct export
- Instagram/Facebook comment extraction via the Meta Graph API
