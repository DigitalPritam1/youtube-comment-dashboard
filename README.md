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

## Roadmap

Not yet built — these need a backend (Supabase or similar):

- Cross-device history and multi-user accounts
- A key proxy so a shared team key is never exposed client-side
- Scheduled/automatic exports (daily pull to Drive or email)
- Google Sheets direct export
- LLM sentiment analysis, theme clustering, and lead/complaint flagging
- Instagram/Facebook comment extraction via the Meta Graph API
