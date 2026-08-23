-- Moore Made Phase 6.61
-- Public voluntary-gift checkout, Stripe settlement tracking, and private gift ledger.
-- Run once in Supabase SQL Editor after Phase 6.59.

create extension if not exists pgcrypto;

create table if not exists public.support_gifts (
  id uuid primary key default gen_random_uuid(),
  receipt_token uuid not null default gen_random_uuid() unique,
  donor_name text not null,
  donor_email text not null,
  suggested_amount_cents bigint check (suggested_amount_cents is null or suggested_amount_cents > 0),
  donor_message text,
  acknowledgement_version text not null default 'MM-GIFT-1.0',
  acknowledgement_text text not null,
  acknowledged_at timestamptz not null,
  stripe_payment_link_id text unique,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_balance_transaction_id text,
  gross_amount_cents bigint check (gross_amount_cents is null or gross_amount_cents >= 0),
  stripe_fee_cents bigint check (stripe_fee_cents is null or stripe_fee_cents >= 0),
  net_amount_cents bigint check (net_amount_cents is null or net_amount_cents >= 0),
  currency text not null default 'usd',
  status text not null default 'pending' check (status in ('pending','link_sent','paid','failed','expired','refunded')),
  checkout_url text,
  link_email_sent_at timestamptz,
  link_email_error text,
  paid_at timestamptz,
  receipt_email_sent_at timestamptz,
  receipt_email_error text,
  funding_entry_id uuid references public.business_funding_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_gifts_created_idx on public.support_gifts(created_at desc);
create index if not exists support_gifts_status_idx on public.support_gifts(status, created_at desc);
alter table public.support_gifts enable row level security;

comment on table public.support_gifts is 'Voluntary, non-repayable gifts to Moore Made LLC. Server-only; separate from orders, loans, investments, and owner contributions.';
comment on column public.support_gifts.acknowledgement_text is 'Exact terms accepted before the unique Stripe link was emailed.';

