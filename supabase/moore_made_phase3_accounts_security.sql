-- Moore Made Phase 3: customer accounts + separate admin identities + security hardening
-- Run AFTER the Phase 2D scalable proof migration.
-- This migration is designed to be idempotent/safe to re-run.

-- 1) Application identities live in Supabase Auth. Public profile data is separate
-- from permissions so a customer can never promote their own account.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_moore_made_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'customer')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_moore_made on auth.users;
create trigger on_auth_user_created_moore_made
after insert on auth.users
for each row execute procedure public.handle_new_moore_made_user();

-- Backfill anyone who already exists in Auth.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
select id, 'customer' from auth.users
on conflict (user_id) do nothing;

-- 2) Tie customer-owned business records to an Auth user.
alter table public.custom_requests
  add column if not exists customer_user_id uuid references auth.users(id) on delete set null;
create index if not exists custom_requests_customer_user_idx on public.custom_requests(customer_user_id, created_at desc);

alter table public.showcase_posts
  add column if not exists customer_user_id uuid references auth.users(id) on delete set null;
create index if not exists showcase_posts_customer_user_idx on public.showcase_posts(customer_user_id, created_at desc);

-- 3) RLS: customers can only read their own rows. Public forms still write through
-- trusted server routes with the server-side Supabase secret key.
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.custom_requests enable row level security;
alter table public.showcase_posts enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_proof_items enable row level security;
alter table public.quote_proof_assets enable row level security;
alter table public.quote_change_requests enable row level security;
alter table public.quote_change_request_items enable row level security;

-- Remove direct anonymous table access. Public pages use Moore Made server routes.
revoke all on table public.profiles from anon;
revoke all on table public.user_roles from anon;
revoke all on table public.custom_requests from anon;
revoke all on table public.showcase_posts from anon;
revoke all on table public.quotes from anon;
revoke all on table public.quote_proof_items from anon;
revoke all on table public.quote_proof_assets from anon;
revoke all on table public.quote_change_requests from anon;
revoke all on table public.quote_change_request_items from anon;

-- Authenticated customers only receive the least privileges needed for their account.
grant select, update on table public.profiles to authenticated;
grant select on table public.user_roles to authenticated;
grant select on table public.custom_requests to authenticated;
grant select on table public.showcase_posts to authenticated;
grant select on table public.quotes to authenticated;
grant select on table public.quote_proof_items to authenticated;
grant select on table public.quote_proof_assets to authenticated;
grant select on table public.quote_change_requests to authenticated;
grant select on table public.quote_change_request_items to authenticated;

-- Profile policies. Role is stored in a different table that customers cannot update.
drop policy if exists "customers read own profile" on public.profiles;
create policy "customers read own profile" on public.profiles
for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists "customers update own profile" on public.profiles;
create policy "customers update own profile" on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "users read own role" on public.user_roles;
create policy "users read own role" on public.user_roles
for select to authenticated
using ((select auth.uid()) = user_id);

-- Orders / reviews owned by the current customer.
drop policy if exists "customers read own requests" on public.custom_requests;
create policy "customers read own requests" on public.custom_requests
for select to authenticated
using (customer_user_id = (select auth.uid()));

drop policy if exists "customers read own showcase submissions" on public.showcase_posts;
create policy "customers read own showcase submissions" on public.showcase_posts
for select to authenticated
using (customer_user_id = (select auth.uid()));

-- Quote and proof policies follow ownership through custom_requests.
drop policy if exists "customers read own quotes" on public.quotes;
create policy "customers read own quotes" on public.quotes
for select to authenticated
using (
  exists (
    select 1 from public.custom_requests r
    where r.id = quotes.request_id
      and r.customer_user_id = (select auth.uid())
  )
);

drop policy if exists "customers read own proof items" on public.quote_proof_items;
create policy "customers read own proof items" on public.quote_proof_items
for select to authenticated
using (
  exists (
    select 1
    from public.quotes q
    join public.custom_requests r on r.id = q.request_id
    where q.id = quote_proof_items.quote_id
      and r.customer_user_id = (select auth.uid())
  )
);

drop policy if exists "customers read own proof assets" on public.quote_proof_assets;
create policy "customers read own proof assets" on public.quote_proof_assets
for select to authenticated
using (
  exists (
    select 1
    from public.quote_proof_items i
    join public.quotes q on q.id = i.quote_id
    join public.custom_requests r on r.id = q.request_id
    where i.id = quote_proof_assets.proof_item_id
      and r.customer_user_id = (select auth.uid())
  )
);

drop policy if exists "customers read own change requests" on public.quote_change_requests;
create policy "customers read own change requests" on public.quote_change_requests
for select to authenticated
using (
  exists (
    select 1
    from public.quotes q
    join public.custom_requests r on r.id = q.request_id
    where q.id = quote_change_requests.quote_id
      and r.customer_user_id = (select auth.uid())
  )
);

drop policy if exists "customers read own change request items" on public.quote_change_request_items;
create policy "customers read own change request items" on public.quote_change_request_items
for select to authenticated
using (
  exists (
    select 1
    from public.quote_change_requests c
    join public.quotes q on q.id = c.quote_id
    join public.custom_requests r on r.id = q.request_id
    where c.id = quote_change_request_items.change_request_id
      and r.customer_user_id = (select auth.uid())
  )
);

-- 4) Private Storage: authenticated customers may read only files attached to
-- their own order/submission. Buckets remain private; no public object policy is added.
drop policy if exists "customers read own request artwork" on storage.objects;
create policy "customers read own request artwork"
on storage.objects for select to authenticated
using (
  bucket_id = 'custom-request-files'
  and exists (
    select 1 from public.custom_requests r
    where r.id::text = (storage.foldername(name))[1]
      and r.customer_user_id = (select auth.uid())
  )
);

drop policy if exists "customers read own quote proofs" on storage.objects;
create policy "customers read own quote proofs"
on storage.objects for select to authenticated
using (
  bucket_id = 'quote-proof-files'
  and exists (
    select 1 from public.custom_requests r
    where r.id::text = (storage.foldername(name))[1]
      and r.customer_user_id = (select auth.uid())
  )
);

drop policy if exists "customers read own showcase photos" on storage.objects;
create policy "customers read own showcase photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'showcase-files'
  and exists (
    select 1 from public.showcase_posts s
    where s.id::text = (storage.foldername(name))[1]
      and s.customer_user_id = (select auth.uid())
  )
);

-- 5) Updated-at helper for account tables.
create or replace function public.set_moore_made_account_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_moore_made_account_updated_at();

drop trigger if exists user_roles_set_updated_at on public.user_roles;
create trigger user_roles_set_updated_at before update on public.user_roles
for each row execute function public.set_moore_made_account_updated_at();

-- IMPORTANT ADMIN SETUP (run manually after each staff member has signed in once):
-- Replace the email below, run once per Moore Made administrator.
--
-- insert into public.user_roles (user_id, role)
-- select id, 'admin' from auth.users where lower(email) = lower('YOUR-ADMIN-EMAIL@example.com')
-- on conflict (user_id) do update set role = 'admin', updated_at = now();
--
-- Do not create an RLS policy that lets users update user_roles.
