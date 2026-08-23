-- Moore Made Phase 6.44: whole-order labor pricing
-- Run once in Supabase after deploying the matching application update.

alter table if exists public.business_settings
  alter column default_labor_rate_cents set default 1500;

alter table if exists public.product_pricing
  alter column default_labor_hours set default 0,
  alter column labor_rate_cents set default 1500;

alter table if exists public.quotes
  alter column labor_rate_cents set default 1500;

alter table if exists public.quote_revisions
  alter column labor_rate_cents set default 1500;

-- Move Moore Made's current starter rate from $10 to $15. A deliberately
-- customized rate is preserved. Existing quote history is never rewritten.
update public.business_settings
set default_labor_rate_cents = 1500,
    minimum_labor_hours = greatest(1, minimum_labor_hours),
    updated_at = now()
where id = 'default'
  and default_labor_rate_cents = 1000;

-- Per-product labor values are retired. Quote labor is stored once on the
-- quote itself and is not multiplied by product quantity or product type.
update public.product_pricing
set default_labor_hours = 0,
    labor_rate_cents = 1500,
    updated_at = now();

comment on column public.business_settings.default_labor_rate_cents is
  'Private hourly labor rate applied once at the quote/order level.';

comment on column public.business_settings.minimum_labor_hours is
  'Minimum labor hours applied once to the complete quote/order.';

comment on column public.product_pricing.default_labor_hours is
  'Legacy compatibility field. Keep at zero; labor is calculated once per quote.';
