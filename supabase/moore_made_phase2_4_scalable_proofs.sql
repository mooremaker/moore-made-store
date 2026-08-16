-- Moore Made Phase 2D: scalable multi-product proof + quote approval
-- Safe to run whether or not the earlier Phase 2C migration was already run.
-- Requires the Phase 2B quotes table to exist.

-- Phase 2C compatibility fields/statuses (idempotent).
alter table public.quotes
  add column if not exists proof_paths text[] not null default '{}',
  add column if not exists proof_notes text,
  add column if not exists proof_version integer not null default 1,
  add column if not exists customer_change_request text;

alter table public.quotes drop constraint if exists quotes_status_check;
alter table public.quotes
  add constraint quotes_status_check
  check (status in ('draft','sent','approved','declined','changes_requested','expired'));

alter table public.custom_requests
  add column if not exists tracking_number text,
  add column if not exists tracking_url text,
  add column if not exists fulfillment_note text,
  add column if not exists fulfillment_notified_at timestamptz;

alter table public.custom_requests drop constraint if exists custom_requests_status_check;
alter table public.custom_requests
  add constraint custom_requests_status_check
  check (status in ('new','reviewing','quote_sent','approved','in_production','ready','shipped','completed','cancelled'));

insert into storage.buckets (id, name, public, file_size_limit)
values ('quote-proof-files', 'quote-proof-files', false, 20971520)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

-- A quote can contain as many logical product/proof items as needed.
create table if not exists public.quote_proof_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  proof_version integer not null default 1 check (proof_version >= 1),
  title text not null,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quote_proof_items_quote_version_idx
  on public.quote_proof_items (quote_id, proof_version, sort_order);

-- Each logical proof item can contain any practical number of images/PDFs.
create table if not exists public.quote_proof_assets (
  id uuid primary key default gen_random_uuid(),
  proof_item_id uuid not null references public.quote_proof_items(id) on delete cascade,
  storage_path text not null,
  original_filename text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists quote_proof_assets_item_idx
  on public.quote_proof_assets (proof_item_id, sort_order);

-- Preserve customer revision history instead of replacing one text field forever.
create table if not exists public.quote_change_requests (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  proof_version integer not null check (proof_version >= 1),
  general_message text,
  created_at timestamptz not null default now()
);

create index if not exists quote_change_requests_quote_idx
  on public.quote_change_requests (quote_id, created_at desc);

create table if not exists public.quote_change_request_items (
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references public.quote_change_requests(id) on delete cascade,
  proof_item_id uuid references public.quote_proof_items(id) on delete set null,
  proof_item_title text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists quote_change_request_items_request_idx
  on public.quote_change_request_items (change_request_id);

-- These tables are intentionally server-only. The app reads/writes them with the
-- server-side Supabase secret key; customers never receive direct table access.
alter table public.quote_proof_items enable row level security;
alter table public.quote_proof_assets enable row level security;
alter table public.quote_change_requests enable row level security;
alter table public.quote_change_request_items enable row level security;

-- If Phase 2C was used before this migration, preserve the current legacy proof
-- as one logical "Order proof" item so existing quotes continue to work.
with legacy_quotes as (
  select q.id as quote_id,
         greatest(coalesce(q.proof_version, 1), 1) as proof_version,
         q.proof_notes,
         q.proof_paths
  from public.quotes q
  where cardinality(coalesce(q.proof_paths, '{}')) > 0
    and not exists (
      select 1 from public.quote_proof_items i where i.quote_id = q.id
    )
),
created_items as (
  insert into public.quote_proof_items (quote_id, proof_version, title, notes, sort_order)
  select quote_id, proof_version, 'Order proof', proof_notes, 0
  from legacy_quotes
  returning id, quote_id, proof_version
)
insert into public.quote_proof_assets (proof_item_id, storage_path, original_filename, sort_order)
select ci.id,
       p.path,
       regexp_replace(p.path, '^.*/', ''),
       (p.ordinality - 1)::integer
from created_items ci
join legacy_quotes lq
  on lq.quote_id = ci.quote_id and lq.proof_version = ci.proof_version
cross join lateral unnest(lq.proof_paths) with ordinality as p(path, ordinality);
