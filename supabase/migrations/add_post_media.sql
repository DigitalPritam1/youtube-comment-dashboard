-- Post/media permalink + thumbnail per comment, so the dashboard can show a
-- clickable link to the source post and a thumbnail. Generic columns, same as
-- the rest of the comment row: video_url = post/media permalink, video_thumb =
-- post/media image. YouTube derives both from video_id client-side, so these
-- stay null for YouTube runs; Facebook/Instagram fill them from Graph.

alter table public.comments add column if not exists video_url text;
alter table public.comments add column if not exists video_thumb text;

-- Surface them on the public share RPC so a shared report keeps its links and
-- thumbnails. Return type changes, so drop then recreate (still token-gated).
drop function if exists public.shared_comments(text, integer, integer);

create function public.shared_comments(
  p_token text, p_limit integer default 1000, p_offset integer default 0
)
returns table (
  video_id text, video_title text, video_url text, video_thumb text,
  author text, "text" text,
  published_at timestamptz, likes integer, reply_count integer, is_reply boolean,
  sentiment text, category text, theme text
)
language sql
security definer
set search_path = public
stable
as $$
  select c.video_id, c.video_title, c.video_url, c.video_thumb, c.author, c.text,
         c.published_at, c.likes, c.reply_count, c.is_reply,
         c.sentiment, c.category, c.theme
  from public.comments c
  join public.runs r on r.id = c.run_id
  where r.share_token = p_token
  order by c.id
  limit greatest(coalesce(p_limit, 1000), 0)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

grant execute on function public.shared_comments(text, integer, integer) to anon, authenticated;
