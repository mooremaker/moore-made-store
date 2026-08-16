-- Moore Made Phase 4B: cash payment arrangement requests
-- Run AFTER the Phase 3 accounts/security migration.
-- Safe to run whether or not the earlier Phase 4 payment migrations were already applied.

-- Make sure the Phase 4 payment summary columns exist because this feature sits on top of them.
alter table public.custom_requests
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists amount_paid_cents integer not null default 0;

-- Track a customer's request to arrange cash payment without marking anything paid.
alter table public.custom_requests
  add column if not exists cash_payment_request_status text not null default 'none',
  add column if not exists cash_payment_requested_at timestamptz,
  add column if not exists cash_payment_requested_amount_cents integer,
  add column if not exists cash_payment_contacted_at timestamptz;

alter table public.custom_requests drop constraint if exists custom_requests_cash_payment_request_status_check;
alter table public.custom_requests
  add constraint custom_requests_cash_payment_request_status_check
  check (cash_payment_request_status in ('none','pending','contacted','completed','cancelled'));

alter table public.custom_requests drop constraint if exists custom_requests_cash_payment_requested_amount_check;
alter table public.custom_requests
  add constraint custom_requests_cash_payment_requested_amount_check
  check (cash_payment_requested_amount_cents is null or cash_payment_requested_amount_cents > 0);

create index if not exists custom_requests_cash_payment_pending_idx
  on public.custom_requests(cash_payment_request_status, cash_payment_requested_at desc);

-- No anonymous write policy is added here. Customer cash-payment requests are accepted only
-- through the quote's unguessable public token and a trusted Next.js server route using the
-- server-side Supabase secret key. Admin updates require authenticated admin + MFA checks.
