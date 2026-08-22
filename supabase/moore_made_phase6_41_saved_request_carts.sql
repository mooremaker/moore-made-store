-- Moore Made Phase 6.41 — multiple named request carts saved to customer accounts
-- Run once in Supabase SQL Editor after installing the matching website package.

create table if not exists public.saved_request_carts (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  cart_items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_request_carts_name_length check (char_length(name) between 1 and 120),
  constraint saved_request_carts_items_array check (jsonb_typeof(cart_items) = 'array')
);

create index if not exists saved_request_carts_customer_updated_idx
  on public.saved_request_carts(customer_user_id, updated_at desc);

alter table public.saved_request_carts enable row level security;

drop policy if exists "Customers can read their saved request carts" on public.saved_request_carts;
create policy "Customers can read their saved request carts"
  on public.saved_request_carts for select
  to authenticated
  using (auth.uid() = customer_user_id);

drop policy if exists "Customers can create their saved request carts" on public.saved_request_carts;
create policy "Customers can create their saved request carts"
  on public.saved_request_carts for insert
  to authenticated
  with check (auth.uid() = customer_user_id);

drop policy if exists "Customers can update their saved request carts" on public.saved_request_carts;
create policy "Customers can update their saved request carts"
  on public.saved_request_carts for update
  to authenticated
  using (auth.uid() = customer_user_id)
  with check (auth.uid() = customer_user_id);

drop policy if exists "Customers can delete their saved request carts" on public.saved_request_carts;
create policy "Customers can delete their saved request carts"
  on public.saved_request_carts for delete
  to authenticated
  using (auth.uid() = customer_user_id);

grant select, insert, update, delete on public.saved_request_carts to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('request-cart-files', 'request-cart-files', false, 20971520)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

comment on table public.saved_request_carts is
  'Multiple named, account-backed customer request carts. Artwork is stored privately in request-cart-files.';

notify pgrst, 'reload schema';

