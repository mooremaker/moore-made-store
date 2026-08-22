-- Moore Made latest database patch
-- Run this ONCE after replacing the project with the latest complete package.
-- Phase 6.40: one-time completed-order review invitation.
alter table public.custom_requests
  add column if not exists review_request_sent_at timestamptz;

comment on column public.custom_requests.review_request_sent_at is
  'When the one-time customer review invitation was successfully claimed and sent after this order was marked completed.';
-- Safe to run if the Phase 4 payment columns already exist.

-- Base payment summary fields expected by the latest admin/account UI.
alter table public.custom_requests
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists amount_paid_cents integer not null default 0;

-- Cash-by-arrangement request tracking.
alter table public.custom_requests
  add column if not exists cash_payment_request_status text not null default 'none',
  add column if not exists cash_payment_requested_at timestamptz,
  add column if not exists cash_payment_requested_amount_cents integer,
  add column if not exists cash_payment_contacted_at timestamptz;

alter table public.custom_requests
  drop constraint if exists custom_requests_cash_payment_request_status_check;

alter table public.custom_requests
  add constraint custom_requests_cash_payment_request_status_check
  check (cash_payment_request_status in ('none','pending','contacted','completed','cancelled'));

alter table public.custom_requests
  drop constraint if exists custom_requests_cash_payment_requested_amount_check;

alter table public.custom_requests
  add constraint custom_requests_cash_payment_requested_amount_check
  check (
    cash_payment_requested_amount_cents is null
    or cash_payment_requested_amount_cents > 0
  );

create index if not exists custom_requests_cash_payment_pending_idx
  on public.custom_requests(
    cash_payment_request_status,
    cash_payment_requested_at desc
  );

-- Tell PostgREST/Supabase to refresh its schema cache immediately.
alter table public.showcase_posts
  add column if not exists customer_primary boolean not null default false;

create unique index if not exists showcase_posts_one_primary_per_user_idx
  on public.showcase_posts (customer_user_id)
  where customer_primary = true and customer_user_id is not null;

create unique index if not exists showcase_posts_one_primary_per_email_idx
  on public.showcase_posts (lower(email))
  where customer_primary = true;

notify pgrst, 'reload schema';

-- Phase 6.43: show successful customer emails in Messages and backfill prior test/resend logs.
create table if not exists public.notification_email_log (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete set null,
  notification_type text not null,
  recipient_email text not null,
  subject text not null,
  status text not null default 'sent',
  provider_message_id text,
  error_message text,
  created_by uuid,
  sent_at timestamptz not null default now()
);

alter table public.message_entries
  add column if not exists notification_log_id uuid references public.notification_email_log(id) on delete set null;

create unique index if not exists message_entries_notification_log_idx
  on public.message_entries(notification_log_id)
  where notification_log_id is not null;

insert into public.message_threads (customer_user_id,request_id,subject,topic,status,customer_unread_count,admin_unread_count,last_message_at)
select distinct on (r.id)
  r.customer_user_id,
  r.id,
  'MM-' || lpad(r.request_number::text, 6, '0') || ' · ' || r.product,
  'order',
  'open',
  0,
  0,
  l.sent_at
from public.notification_email_log l
join public.custom_requests r on r.id = l.request_id
where l.status = 'sent'
  and r.customer_user_id is not null
  and lower(l.recipient_email) = lower(r.email)
order by r.id, l.sent_at desc
on conflict (request_id) where request_id is not null do nothing;

insert into public.message_entries (thread_id,sender_user_id,sender_role,sender_display_name,body,is_internal,created_at,notification_log_id)
select t.id,null,'system','Moore Made email','Previously sent email' || E'\n\n' || l.subject,false,l.sent_at,l.id
from public.notification_email_log l
join public.custom_requests r on r.id = l.request_id
join public.message_threads t on t.request_id = r.id
where l.status = 'sent'
  and r.customer_user_id is not null
  and lower(l.recipient_email) = lower(r.email)
on conflict (notification_log_id) where notification_log_id is not null do nothing;

update public.message_threads t
set last_message_at = latest.sent_at
from (
  select request_id, max(sent_at) as sent_at
  from public.notification_email_log
  where status = 'sent'
  group by request_id
) latest
where t.request_id = latest.request_id
  and latest.sent_at > t.last_message_at;

notify pgrst, 'reload schema';

-- Phase 6.42: customer business profiles and reusable brand logos.
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
set public = false, file_size_limit = excluded.file_size_limit;

notify pgrst, 'reload schema';

-- Phase 6.41: multiple named request carts saved to customer accounts.
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
  on public.saved_request_carts for select to authenticated
  using (auth.uid() = customer_user_id);

drop policy if exists "Customers can create their saved request carts" on public.saved_request_carts;
create policy "Customers can create their saved request carts"
  on public.saved_request_carts for insert to authenticated
  with check (auth.uid() = customer_user_id);

drop policy if exists "Customers can update their saved request carts" on public.saved_request_carts;
create policy "Customers can update their saved request carts"
  on public.saved_request_carts for update to authenticated
  using (auth.uid() = customer_user_id)
  with check (auth.uid() = customer_user_id);

drop policy if exists "Customers can delete their saved request carts" on public.saved_request_carts;
create policy "Customers can delete their saved request carts"
  on public.saved_request_carts for delete to authenticated
  using (auth.uid() = customer_user_id);

grant select, insert, update, delete on public.saved_request_carts to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('request-cart-files', 'request-cart-files', false, 20971520)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit;

notify pgrst, 'reload schema';
