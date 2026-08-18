-- Moore Made Phase 6.21
-- Per-photo preview framing for compact Made by You cards.
-- This changes only how a stored photo is framed in cropped previews;
-- the original uploaded image remains untouched for the full gallery/lightbox.

alter table public.showcase_posts
  add column if not exists photo_preview_settings jsonb not null default '{}'::jsonb;

comment on column public.showcase_posts.photo_preview_settings is
  'Admin-defined per-photo preview framing keyed by storage path: {x, y, zoom}. Original photos are not modified.';

notify pgrst, 'reload schema';
