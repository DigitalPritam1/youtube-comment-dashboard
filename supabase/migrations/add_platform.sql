-- Meta (Facebook + Instagram) support: each run remembers its platform so the
-- UI, badges, and the scheduled refresh can branch. The comments table is
-- unchanged — its generic columns hold Meta data (video_id = post/media id,
-- video_title = caption, comment_id = Meta comment id, published_at =
-- created_time/timestamp, likes = like_count, reply_count = comment_count).

alter table public.runs add column if not exists platform text not null default 'youtube';

-- Surface the platform on the public share RPC so a shared report can badge it.
-- Return type changes, so drop then recreate. Still token-gated, no owner leak.
drop function if exists public.shared_run(text);

create function public.shared_run(p_token text)
returns table (
  name text, source_label text, source_type text, platform text,
  total_videos integer, total_comments integer,
  video_stats jsonb, created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select r.name, r.source_label, r.source_type, r.platform,
         r.total_videos, r.total_comments, r.video_stats, r.created_at
  from public.runs r
  where r.share_token = p_token
  limit 1
$$;

grant execute on function public.shared_run(text) to anon, authenticated;
