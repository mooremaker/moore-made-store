-- Moore Made — Phase 6.38
-- Admin-selected main review within each customer's public review carousel.

begin;

alter table public.showcase_posts
  add column if not exists customer_primary boolean not null default false;

comment on column public.showcase_posts.customer_primary is
  'Admin-selected review shown first within this customer’s Made by You review carousel.';

create unique index if not exists showcase_posts_one_primary_per_user_idx
  on public.showcase_posts (customer_user_id)
  where customer_primary = true and customer_user_id is not null;

create unique index if not exists showcase_posts_one_primary_per_email_idx
  on public.showcase_posts (lower(email))
  where customer_primary = true;

notify pgrst, 'reload schema';

commit;
