-- Moore Made Phase 6.42 — customer business profiles, reusable logos, and reorder support
-- Run once in Supabase SQL Editor after installing the matching website package.

create table if not exists public.customer_business_profiles (
  customer_user_id uuid primary key references auth.users(id) on delete cascade,
  business_name text,
  website text,
  brand_colors jsonb not null default '[]'::jsonb,
  brand_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_business_profiles_colors_array check (jsonb_typeof(brand_colors) = 'array')
);

create table if not exists public.client_brand_assets (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  storage_bucket text not null default 'customer-brand-assets',
  storage_path text not null,
  original_filename text,
  asset_kind text not null default 'logo' check (asset_kind in ('logo','artwork','mark','other')),
  production_approved boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_brand_assets
  add column if not exists storage_bucket text not null default 'mockup-studio-files';

create index if not exists client_brand_assets_customer_idx
  on public.client_brand_assets(customer_user_id, updated_at desc);

create or replace function public.set_customer_business_profile_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customer_business_profiles_set_updated_at on public.customer_business_profiles;
create trigger customer_business_profiles_set_updated_at
before update on public.customer_business_profiles
for each row execute function public.set_customer_business_profile_updated_at();

alter table public.customer_business_profiles enable row level security;
alter table public.client_brand_assets enable row level security;

drop policy if exists "Customers manage their business profile" on public.customer_business_profiles;
create policy "Customers manage their business profile"
  on public.customer_business_profiles for all to authenticated
  using (customer_user_id = auth.uid())
  with check (customer_user_id = auth.uid());

drop policy if exists "Customers read own brand assets" on public.client_brand_assets;
create policy "Customers read own brand assets"
  on public.client_brand_assets for select to authenticated
  using (customer_user_id = auth.uid());

grant select, insert, update, delete on public.customer_business_profiles to authenticated;
grant select on public.client_brand_assets to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('customer-brand-assets', 'customer-brand-assets', false, 20971520)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

comment on table public.customer_business_profiles is
  'Customer-owned reusable business identity, brand colors, website, and design notes.';

notify pgrst, 'reload schema';
