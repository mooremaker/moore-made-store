-- Moore Made Phase 6.8
-- Customer-owned Made by You drafts, editing, and published-version preservation.

alter table public.showcase_posts
  add column if not exists published_snapshot jsonb,
  add column if not exists published_photo_paths text[] not null default '{}',
  add column if not exists published_at timestamptz,
  add column if not exists submitted_at timestamptz;

alter table public.showcase_posts
  drop constraint if exists showcase_posts_status_check;

alter table public.showcase_posts
  add constraint showcase_posts_status_check
  check (status in ('draft','pending','approved','rejected'));

-- Preserve the currently approved version of existing published reviews.
update public.showcase_posts
set
  published_snapshot = jsonb_build_object(
    'customer_name', customer_name,
    'business_name', business_name,
    'product', product,
    'rating', rating,
    'review', review,
    'caption', caption,
    'social_handle', social_handle
  ),
  published_photo_paths = coalesce(photo_paths, '{}'),
  published_at = coalesce(approved_at, updated_at, created_at),
  submitted_at = coalesce(submitted_at, created_at)
where status = 'approved'
  and published_snapshot is null;

update public.showcase_posts
set submitted_at = coalesce(submitted_at, created_at)
where status in ('pending','approved','rejected');

create index if not exists showcase_posts_customer_status_idx
  on public.showcase_posts(customer_user_id, status, updated_at desc);

notify pgrst, 'reload schema';
