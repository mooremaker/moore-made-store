-- Moore Made Phase 6.48: private Stripe settlement accounting.
-- Run once after deploying the matching application update.

alter table public.payments
  add column if not exists stripe_fee_cents integer check (stripe_fee_cents is null or stripe_fee_cents >= 0),
  add column if not exists stripe_net_cents integer check (stripe_net_cents is null or stripe_net_cents >= 0),
  add column if not exists stripe_balance_transaction_id text;

comment on column public.payments.stripe_fee_cents is
  'Actual private Stripe processing fee retrieved from the settled balance transaction.';
comment on column public.payments.stripe_net_cents is
  'Actual net Stripe settlement after Stripe processing fees; never shown to customers.';
comment on column public.payments.stripe_balance_transaction_id is
  'Stripe balance transaction used to reconcile gross payment, fee, and net settlement.';

notify pgrst, 'reload schema';
