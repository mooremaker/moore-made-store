-- Moore Made — Phase 6.24
-- One admin-selected homepage review + grouped customer reviews.
-- Additive only: does not delete or rebuild any review data.

begin;

alter table public.showcase_posts
  add column if not exists homepage_featured boolean not null default false;

comment on column public.showcase_posts.homepage_featured is
  'Admin-selected review shown first on the Moore Made homepage. At most one review may be featured at a time.';

-- Protect against accidentally featuring two reviews at once.
create unique index if not exists showcase_posts_one_homepage_featured_idx
  on public.showcase_posts (homepage_featured)
  where homepage_featured = true;

notify pgrst, 'reload schema';

commit;
