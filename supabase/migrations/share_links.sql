-- Shareable report links (capability-URL model).
--
-- Every run carries an unguessable 122-bit token, minted automatically. Anyone
-- with the token can read that one run through the SECURITY DEFINER functions
-- below; every other path stays blocked by row-level security. The functions
-- return no user_id, no source_value, and not the token itself, so a shared
-- link cannot leak the owner or be used to enumerate other runs.
--
-- The two SECURITY DEFINER functions are intentionally callable by the anon
-- role — that is the whole point of a public share link. Supabase's linter
-- flags this (0028/0029); it is expected here, not a defect.

alter table public.runs
  add column share_token text unique
  default replace(gen_random_uuid()::text, '-', '');

update public.runs set share_token = replace(gen_random_uuid()::text, '-', '')
  where share_token is null;

alter table public.runs alter column share_token set not null;

create or replace function public.shared_run(p_token text)
returns table (
  name text, source_label text, source_type text,
  total_videos integer, total_comments integer,
  video_stats jsonb, created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select r.name, r.source_label, r.source_type,
         r.total_videos, r.total_comments, r.video_stats, r.created_at
  from public.runs r
  where r.share_token = p_token
  limit 1
$$;

create or replace function public.shared_comments(
  p_token text, p_limit integer default 1000, p_offset integer default 0
)
returns table (
  video_id text, video_title text, author text, "text" text,
  published_at timestamptz, likes integer, reply_count integer, is_reply boolean,
  sentiment text, category text, theme text
)
language sql
security definer
set search_path = public
stable
as $$
  select c.video_id, c.video_title, c.author, c.text, c.published_at,
         c.likes, c.reply_count, c.is_reply, c.sentiment, c.category, c.theme
  from public.comments c
  join public.runs r on r.id = c.run_id
  where r.share_token = p_token
  order by c.id
  limit greatest(coalesce(p_limit, 1000), 0)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

grant execute on function public.shared_run(text) to anon, authenticated;
grant execute on function public.shared_comments(text, integer, integer) to anon, authenticated;
