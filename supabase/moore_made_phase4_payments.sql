-- Moore Made Phase 4: Stripe payments
-- Run this AFTER the Phase 3 Accounts + Security migration.
-- Safe to run once on the existing Moore Made project.

-- 1) Payment terms are part of the proof + quote the customer approves.
alter table public.quotes
  add column if not exists payment_terms text not null default 'full',
  add column if not exists deposit_amount_cents integer;

alter table public.quotes drop constraint if exists quotes_payment_terms_check;
alter table public.quotes
  add constraint quotes_payment_terms_check
  check (payment_terms in ('full','deposit'));

alter table public.quotes drop constraint if exists quotes_deposit_amount_check;
alter table public.quotes
  add constraint quotes_deposit_amount_check
  check (deposit_amount_cents is null or deposit_amount_cents >= 0);

-- Existing quotes remain full-payment quotes by default.
update public.quotes
set payment_terms = 'full', deposit_amount_cents = null
where payment_terms is null;

-- 2) Keep a quick payment summary on the order for admin/account screens.
alter table public.custom_requests
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists amount_paid_cents integer not null default 0;

alter table public.custom_requests drop constraint if exists custom_requests_payment_status_check;
alter table public.custom_requests
  add constraint custom_requests_payment_status_check
  check (payment_status in ('unpaid','deposit_paid','paid'));

alter table public.custom_requests drop constraint if exists custom_requests_amount_paid_check;
alter table public.custom_requests
  add constraint custom_requests_amount_paid_check
  check (amount_paid_cents >= 0);

-- 3) Every Stripe checkout attempt/payment gets its own durable record.
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  payment_kind text not null check (payment_kind in ('full','deposit','balance')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_request_idx on public.payments(request_id, created_at desc);
create index if not exists payments_quote_idx on public.payments(quote_id, created_at desc);
create index if not exists payments_stripe_intent_idx on public.payments(stripe_payment_intent_id);

create or replace function public.set_payment_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_payment_updated_at();

-- 4) Customers can read only payment records tied to their own order.
alter table public.payments enable row level security;
revoke all on table public.payments from anon;
grant select on table public.payments to authenticated;

drop policy if exists "customers read own payments" on public.payments;
create policy "customers read own payments" on public.payments
for select to authenticated
using (
  exists (
    select 1 from public.custom_requests r
    where r.id = payments.request_id
      and r.customer_user_id = (select auth.uid())
  )
);

-- IMPORTANT:
-- Stripe writes are performed only by trusted Next.js server routes using the
-- server-side Supabase secret key. Customers never receive insert/update access
-- to the payments table.
