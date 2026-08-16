-- Moore Made latest database patch
-- Run this ONCE after replacing the project with the latest complete package.
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
notify pgrst, 'reload schema';
