-- Moore Made Phase 6.22 — Admin Mockup Studio + future client/template foundation
-- Run after the existing account/security and proof/quote migrations.

insert into storage.buckets (id, name, public, file_size_limit)
values ('mockup-studio-files', 'mockup-studio-files', false, 20971520)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create table if not exists public.mockup_projects (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  customer_user_id uuid references auth.users(id) on delete set null,
  title text not null default 'Order mockup',
  status text not null default 'draft' check (status in ('draft','proof_ready','archived')),
  document jsonb not null default '{"version":1,"views":[]}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists mockup_projects_request_unique
  on public.mockup_projects(request_id)
  where status <> 'archived';
create index if not exists mockup_projects_customer_idx
  on public.mockup_projects(customer_user_id, updated_at desc);

-- Empty now, but these are the shared foundations the future Shop and Client Portal
-- can use without rebuilding the mockup engine.
create table if not exists public.product_mockup_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_key text,
  color_name text,
  visibility text not null default 'admin' check (visibility in ('admin','client','shop')),
  template_document jsonb not null default '{"version":1,"views":[]}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_brand_assets (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  storage_path text not null,
  original_filename text,
  asset_kind text not null default 'artwork' check (asset_kind in ('logo','artwork','mark','other')),
  production_approved boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_brand_assets_customer_idx
  on public.client_brand_assets(customer_user_id, updated_at desc);

create or replace function public.set_mockup_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mockup_projects_set_updated_at on public.mockup_projects;
create trigger mockup_projects_set_updated_at
before update on public.mockup_projects
for each row execute function public.set_mockup_updated_at();

drop trigger if exists product_mockup_templates_set_updated_at on public.product_mockup_templates;
create trigger product_mockup_templates_set_updated_at
before update on public.product_mockup_templates
for each row execute function public.set_mockup_updated_at();

drop trigger if exists client_brand_assets_set_updated_at on public.client_brand_assets;
create trigger client_brand_assets_set_updated_at
before update on public.client_brand_assets
for each row execute function public.set_mockup_updated_at();

alter table public.mockup_projects enable row level security;
alter table public.product_mockup_templates enable row level security;
alter table public.client_brand_assets enable row level security;

revoke all on table public.mockup_projects from anon;
revoke all on table public.product_mockup_templates from anon;
revoke all on table public.client_brand_assets from anon;

-- Admin V1 uses trusted server routes. Customer policies are intentionally read-only
-- foundations for the later Client Portal; customer-created designs will receive
-- their own explicit write routes when that interface is released.
grant select on table public.mockup_projects to authenticated;
grant select on table public.product_mockup_templates to authenticated;
grant select on table public.client_brand_assets to authenticated;

drop policy if exists "customers read own mockup projects" on public.mockup_projects;
create policy "customers read own mockup projects" on public.mockup_projects
for select to authenticated
using (customer_user_id = (select auth.uid()));

drop policy if exists "customers read available mockup templates" on public.product_mockup_templates;
create policy "customers read available mockup templates" on public.product_mockup_templates
for select to authenticated
using (is_active and visibility in ('client','shop'));

drop policy if exists "customers read own brand assets" on public.client_brand_assets;
create policy "customers read own brand assets" on public.client_brand_assets
for select to authenticated
using (customer_user_id = (select auth.uid()));

-- Customers can later display mockup assets belonging to their own order. Uploads
-- remain server-authorized only in this first admin release.
drop policy if exists "customers read own mockup studio files" on storage.objects;
create policy "customers read own mockup studio files"
on storage.objects for select to authenticated
using (
  bucket_id = 'mockup-studio-files'
  and exists (
    select 1 from public.custom_requests r
    where r.id::text = (storage.foldername(name))[1]
      and r.customer_user_id = (select auth.uid())
  )
);
