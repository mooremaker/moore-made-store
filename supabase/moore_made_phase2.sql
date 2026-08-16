-- Moore Made Phase 2: custom request inbox + private artwork storage

create table if not exists public.custom_requests (
  id uuid primary key default gen_random_uuid(),
  request_number bigint generated always as identity unique,
  submission_token uuid not null default gen_random_uuid(),
  customer_name text not null,
  email text not null,
  phone text,
  sms_consent boolean not null default false,
  sms_consent_at timestamptz,
  product text not null,
  quantity integer not null check (quantity > 0),
  item_type text,
  colors text,
  sizes text,
  logo_size text,
  print_sides text,
  placements text[] not null default '{}',
  artwork_instructions text,
  deadline date,
  delivery text,
  notes text,
  artwork_paths text[] not null default '{}',
  status text not null default 'new' check (
    status in ('new','reviewing','quote_sent','approved','in_production','ready','completed','cancelled')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.custom_requests enable row level security;

-- No public table policies are intentionally created. The website's server-side
-- secret key handles inserts/admin reads while customer file uploads use a
-- time-limited signed upload token.

create or replace function public.set_custom_request_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists custom_requests_set_updated_at on public.custom_requests;
create trigger custom_requests_set_updated_at
before update on public.custom_requests
for each row execute function public.set_custom_request_updated_at();

insert into storage.buckets (id, name, public, file_size_limit)
values ('custom-request-files', 'custom-request-files', false, 20971520)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;


-- Phase 2.1: Made by You customer showcase
create table if not exists public.showcase_posts (
  id uuid primary key default gen_random_uuid(),
  submission_token uuid not null default gen_random_uuid(),
  customer_name text not null,
  business_name text,
  email text not null,
  product text not null,
  rating integer not null check (rating between 1 and 5),
  review text not null,
  caption text,
  social_handle text,
  display_permission boolean not null default false,
  photo_paths text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.showcase_posts enable row level security;

create or replace function public.set_showcase_post_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists showcase_posts_set_updated_at on public.showcase_posts;
create trigger showcase_posts_set_updated_at before update on public.showcase_posts for each row execute function public.set_showcase_post_updated_at();

insert into storage.buckets (id, name, public, file_size_limit)
values ('showcase-files', 'showcase-files', false, 15728640)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;
