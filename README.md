# YouTube Comment Dashboard

A client-side dashboard for extracting and exploring comments (and replies) from
YouTube, using the YouTube Data API v3. Runs entirely in the browser — no server,
no build step.

**Live site:** https://digitalpritam1.github.io/youtube-comment-dashboard/

## Contents

- `index.html` — the dashboard (single file, no build step).
- `youtube_comment_extractor.py` — command-line version that exports a whole
  channel's comments to CSV, for scheduled/automated runs.

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

**Export** — CSV, JSON, and Excel (`.xlsx`, with column widths, a frozen header
row, and autofilter).

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

**1. Set the shared YouTube key.** In the Supabase dashboard →
*Edge Functions → Secrets*, add `YOUTUBE_API_KEY` with your key. Until this is
set, the proxy returns a clear 503 and "use my own key" still works.

**2. Approve who may use it.** The dashboard is on a public URL, so anyone can
create an account. Their own data stays isolated by row-level security, but only
allowlisted addresses may spend the shared key:

```sql
insert into public.allowed_emails (email, note) values ('teammate@example.com', 'why');
```

`pritam@indianfarmer.com` is already listed.

**3. Email delivery.** Supabase's built-in SMTP is rate-limited to a handful of
messages per hour — fine for one person, not for a team. Configure custom SMTP
under *Authentication → Emails* before more than one or two people rely on it.

### Data model

| Table | Purpose |
|---|---|
| `runs` | One row per saved extraction (name, source, totals, per-video stats) |
| `comments` | One row per comment, `run_id` FK with cascade delete |
| `allowed_emails` | Who may use the shared key. RLS on, no policies — unreachable from the browser by design |

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

- Scheduled/automatic pulls (cron → database, no one at the keyboard)
- Google Sheets direct export
- LLM sentiment analysis, theme clustering, and lead/complaint flagging
- Instagram/Facebook comment extraction via the Meta Graph API
