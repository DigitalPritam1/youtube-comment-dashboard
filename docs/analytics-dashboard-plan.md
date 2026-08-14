# Brand Analytics Dashboard — plan

A **second page** in the same site that shows top-line numbers across every brand
and every platform in one view, with export.

**Not** a rebuild of the comments dashboard. It sits alongside it, uses the same
sign-in, same allowlist, same Meta proxy, and links back and forth.

## The page

**URL:** `/analytics/` (a new `analytics.html` in the repo root, served by the same
GitHub Pages site). One click from the main dashboard.

**On first open, you configure your brands once:**
- YouTube channels — paste each handle (`@IndianFarmerOfficial`, `@HavamanAndaj`,
  …). Auto-resolved to channel IDs.
- Facebook Pages — dropdown auto-populated from the same `pages` action we already
  built for the comments dashboard.
- Instagram accounts — same dropdown, filtered to Pages that have a linked IG.
- Each source is tagged with a **brand name** (Indian Farmer / Indian Farmer
  Courses / Santosh Jadhav) so we can total per-brand and grand-total.

**On every open after that:** the page collects a snapshot (cheap calls only) and
shows it live.

## What the page shows

**Big-number tiles at the top (grand totals across everything):**

| Content pieces | Followers | Views | Comments | Engagement |
|---|---|---|---|---|

**Per-brand breakdown** — one row per source, columns:

`Brand · Platform · Handle · Posts · Followers · Views · Likes/Reactions · Comments · Shares · Total engagement · Last snapshot at`

**Per-brand totals** — one row per brand summing its platforms.

**Export button** — CSV + Excel. Same file-naming convention as the comments
export (Unicode-slug, sourced from brand name + date).

## What each number actually is (honestly)

| Metric | YouTube | Facebook Page | Instagram Business |
|---|---|---|---|
| Content pieces | `channel.statistics.videoCount` (1 call) | `/{page}/posts?summary=true` (1 call) | `media_count` field (1 call) |
| Followers | `channel.statistics.subscriberCount` (1 call) | `followers_count` field (1 call) | `followers_count` field (1 call) |
| Views | `channel.statistics.viewCount` (1 call, real lifetime) | ⚠️ `"video posts only, see note"` | ⚠️ `"reels/video only, see note"` |
| Comments | Sum of `commentCount` across videos, batched 50/call | Sum of `comments.summary(true).total_count` across posts | Sum of `comments_count` across media |
| Likes/reactions | Sum of `likeCount` across videos | Sum of `reactions.summary(true).total_count` across posts | Sum of `like_count` across media |
| Shares | — (YouTube API doesn't expose share counts) | Sum of `shares.count` across posts | — (Meta doesn't expose IG shares in Graph) |
| Engagement | likes + comments | reactions + comments + shares | likes + comments |

**The view-count honesty note:** getting a true "total views everywhere" for FB
photo posts and IG photo posts requires per-post *insights* calls (one API call per
post, rate-limited). For a Page with 2,500 posts that's ~2,500 calls per open — not
practical for a live snapshot. So Phase A shows what's cheaply available (YT
real totals, FB/IG videos-only totals with a clear "photos not counted" label). A
Phase B *"deep collect"* button, run overnight, can fill this in properly and store
it. Called out plainly in the UI so nothing feels misleading.

## Speed

- YouTube brand: ~2–5 seconds.
- Small FB Page (few hundred posts): ~5–15 seconds.
- Large FB Page (2,500+ posts): ~1–3 minutes (paging through all posts to sum
  engagement). The page shows a progress bar the same way the comments fetch does,
  and streams the per-source rows as they finish rather than blocking on the total.

Sign-in tokens auto-refresh mid-run (already fixed for the comments dashboard;
the same helper applies here).

## Backend changes

### DB — one migration, two small tables

```sql
create table analytics_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand text not null,               -- 'Indian Farmer', 'Santosh Jadhav', …
  platform text not null,            -- 'youtube' | 'facebook' | 'instagram'
  source_id text not null,           -- YT channel id, FB page id, IG user id
  label text,                        -- display name / handle
  created_at timestamptz default now(),
  unique (user_id, platform, source_id)
);

create table analytics_snapshots (
  id bigint primary key generated always as identity,
  source_id uuid references analytics_sources(id) on delete cascade,
  captured_at timestamptz default now(),
  totals jsonb not null              -- posts, followers, views, likes, comments, shares, engagement
);
create index on analytics_snapshots (source_id, captured_at desc);
```

Same RLS pattern as `runs` (owner-only). Both tables are user-scoped.

### Edge functions — small tweaks, no new function

Both proxies already allow arbitrary parameter queries through a whitelisted
endpoint set. Extending each is minimal:

- **`yt-proxy`:** allow `channels` and `videos` endpoints (they're likely already
  allowed via the existing whitelist — verify and add if not).
- **`meta-proxy`:** node lookups (single-part paths like `/{page-id}`,
  `/{ig-user-id}`) are already allowed, so `fields=followers_count,fan_count,…` and
  `fields=media_count,followers_count` work today. No change needed.

No new edge function. All collection happens client-side, in the new page, using
the two existing proxies.

## Frontend structure

- **`analytics.html`** — new file at repo root. Reuses the `<style>` block from
  `index.html` for the premium look (same fonts, tokens, cards).
- **Shared JS:** copies the auth/session-refresh helper and the `metaFetch`/
  `ytFetch` pair. No new module system — this stays a single-file page like the
  main dashboard.
- **Link in the main dashboard header:** *"Analytics →"* button next to the
  sign-in area.

## Preloaded brand defaults (per your choice)

On first open, if `analytics_sources` is empty for the user, seed with:

- **Indian Farmer** — YouTube `@IndianFarmerOfficial`, FB *Indian Farmer* Page,
  IG account linked to that Page.
- **Indian Farmer Courses** — FB *Courses by Indian Farmer* Page, IG
  `@indianfarmer.courses`, YouTube (if handle known — otherwise a "paste your
  YouTube channel" prompt).
- **Santosh Jadhav** — FB Santosh Jadhav Page, IG `@santoshjadhav.if`, YouTube (if
  handle known).

FB/IG defaults are populated automatically from the `pages` action. **The two
YouTube handles I don't have** (Indian Farmer Courses, Santosh Jadhav) — the page
prompts you to paste them on first open. Every default is editable from a "Manage
sources" panel.

## Export

CSV + XLSX. Two sheets in the Excel file:
- **Totals** — one row per source, plus grand-total.
- **History** — pulled from `analytics_snapshots`, one row per (source, day),
  useful when you drop it into Google Sheets to graph.

Filename: `{brand-name-slug}-analytics-{YYYY-MM-DD}.xlsx`, matching the existing
comments-export convention.

## Milestones

| Phase | What ships | Est effort |
|---|---|---|
| **A0** — plan doc & DB migration | this file; both tables live in Supabase | small |
| **A1** — page skeleton | `/analytics/`, sign-in gate, links from/to main dashboard, empty state | small |
| **A2** — source manager | Add / rename / remove sources; FB/IG dropdowns auto-populated; YT handle input; preloaded defaults on first open | medium |
| **A3** — snapshot collection + top-line UI | Per-source snapshot with progress; big tiles + per-brand table; stored in `analytics_snapshots` on each open | medium |
| **A4** — export | CSV + XLSX with Totals + History sheets | small |
| **B** *(later)* | Growth charts (Chart.js line, 30/90-day compare); "deep collect" for real FB/IG view counts; best-post highlights | medium |

## Risks and gotchas I want on the record

- **`followers_count` needs `pages_read_engagement` and *sometimes* `read_insights`**
  depending on the Meta API version and the account age. If a field comes back
  missing for a specific Page, the UI shows "—" and points at
  [`docs/meta-setup/`](meta-setup/README.md) rather than pretending zero.
- **YouTube subscriber counts are rounded** for public channels (Meta of YouTube's
  own doing since 2019). We display the rounded number; that's just how the API
  works.
- **IG doesn't expose share counts in Graph.** The engagement column omits them
  rather than inventing a zero.
- **Rate limits.** If a snapshot mid-run gets throttled, the same partial-run
  handling we just built for comment saves applies — whatever was collected is
  persisted, and clicking again picks up where it left off.
- **Cost.** All calls are on your existing YouTube/Meta quotas. YouTube's per-day
  quota (10,000 units default) easily covers dozens of full snapshots. Meta doesn't
  charge for these reads.
