-- Moore Made Phase 6.63: automatic New Customer Appreciation Discount
-- Run once in Supabase SQL Editor after Phase 6.25 pricing/discounts.
-- The code remains editable in Admin → Financials → Discounts. Keep its code
-- as MOOREMADE15 so new quotes continue to apply it automatically.

insert into public.discount_codes (
  code,
  description,
  kind,
  percent_off,
  amount_off_cents,
  active,
  starts_at,
  expires_at,
  max_uses,
  per_customer_limit
)
select
  'MOOREMADE15',
  'Moore Made New Customer Appreciation Discount · 15% off',
  'percent',
  15,
  null,
  true,
  null,
  null,
  null,
  null
where not exists (
  select 1 from public.discount_codes where upper(code) = 'MOOREMADE15'
);
