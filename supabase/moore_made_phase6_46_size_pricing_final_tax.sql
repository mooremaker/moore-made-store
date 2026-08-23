-- Moore Made Phase 6.46: size-aware supplier/customer pricing and final tax snapshots.
-- Run once in Supabase after deploying the matching application update.

alter table if exists public.product_pricing
  add column if not exists size_blank_costs jsonb not null default '{}'::jsonb,
  add column if not exists size_customer_surcharges jsonb not null default '{}'::jsonb;

alter table if exists public.quotes
  add column if not exists internal_supplier_costs jsonb not null default '[]'::jsonb,
  add column if not exists tax_code text,
  add column if not exists estimated_tax_cents integer not null default 0 check (estimated_tax_cents >= 0),
  add column if not exists stripe_tax_transaction_id text;

alter table if exists public.payments
  add column if not exists order_tax_cents integer check (order_tax_cents is null or order_tax_cents >= 0),
  add column if not exists order_total_cents integer check (order_total_cents is null or order_total_cents >= 0);

comment on column public.product_pricing.size_blank_costs is
  'Admin-only supplier cost per size. Values are editable estimates until the actual vendor receipt is recorded.';
comment on column public.product_pricing.size_customer_surcharges is
  'Customer-facing amount added to the product base price for a specific size.';
comment on column public.quotes.estimated_tax_cents is
  'Sales-tax estimate shown when the customer approved the quote. tax_cents may later hold the final payment-time calculation.';
