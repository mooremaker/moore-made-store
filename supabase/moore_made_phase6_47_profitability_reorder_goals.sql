-- Moore Made Phase 6.47: profitability safeguards, weekly targets,
-- decoration-location costs, and completed-order reorder price protection.
-- Run once in Supabase after Phase 6.46.

alter table if exists public.business_settings
  add column if not exists margin_1_9_basis_points integer not null default 5500 check (margin_1_9_basis_points between 0 and 9500),
  add column if not exists margin_10_24_basis_points integer not null default 5000 check (margin_10_24_basis_points between 0 and 9500),
  add column if not exists margin_25_49_basis_points integer not null default 4500 check (margin_25_49_basis_points between 0 and 9500),
  add column if not exists margin_50_plus_basis_points integer not null default 4250 check (margin_50_plus_basis_points between 0 and 9500),
  add column if not exists minimum_margin_floor_basis_points integer not null default 3500 check (minimum_margin_floor_basis_points between 0 and 9500),
  add column if not exists standard_shirt_min_profit_cents integer not null default 1200 check (standard_shirt_min_profit_cents >= 0),
  add column if not exists outsourced_min_margin_basis_points integer not null default 3500 check (outsourced_min_margin_basis_points between 0 and 9500),
  add column if not exists overhead_basis_points integer not null default 1000 check (overhead_basis_points between 0 and 5000),
  add column if not exists payment_fee_basis_points integer not null default 290 check (payment_fee_basis_points between 0 and 2000),
  add column if not exists payment_fee_fixed_cents integer not null default 30 check (payment_fee_fixed_cents >= 0),
  add column if not exists default_shipping_charge_cents integer not null default 0 check (default_shipping_charge_cents >= 0),
  add column if not exists labor_warning_minutes_per_piece numeric(8,2) not null default 3 check (labor_warning_minutes_per_piece >= 0),
  add column if not exists weekly_sales_goal_cents integer not null default 750000 check (weekly_sales_goal_cents > 0),
  add column if not exists weekly_profit_goal_cents integer not null default 300000 check (weekly_profit_goal_cents > 0),
  add column if not exists weekly_owner_goal_cents integer not null default 270000 check (weekly_owner_goal_cents >= 0),
  add column if not exists weekly_reserve_goal_cents integer not null default 30000 check (weekly_reserve_goal_cents >= 0);

alter table if exists public.business_settings
  alter column default_labor_rate_cents set default 2500;

update public.business_settings
set default_labor_rate_cents = 2500
where id = 'default' and default_labor_rate_cents = 1500;

alter table if exists public.product_pricing
  add column if not exists additional_location_cost_cents integer not null default 0 check (additional_location_cost_cents >= 0),
  add column if not exists minimum_profit_per_item_cents integer not null default 0 check (minimum_profit_per_item_cents >= 0);

update public.product_pricing
set minimum_profit_per_item_cents = 1200
where product_slug = 'custom-t-shirts' and minimum_profit_per_item_cents = 0;

update public.product_pricing
set additional_location_cost_cents = print_cost_cents
where additional_location_cost_cents = 0 and print_cost_cents > 0;

alter table if exists public.quotes
  add column if not exists internal_supplier_shipping_cents integer not null default 0 check (internal_supplier_shipping_cents >= 0),
  add column if not exists internal_supplier_tax_cents integer not null default 0 check (internal_supplier_tax_cents >= 0),
  add column if not exists internal_overhead_cents integer not null default 0 check (internal_overhead_cents >= 0),
  add column if not exists is_outsourced_order boolean not null default false,
  add column if not exists profitability_override_reason text,
  add column if not exists profitability_warnings jsonb not null default '[]'::jsonb,
  add column if not exists pricing_settings_snapshot jsonb;

alter table if exists public.quote_revisions
  add column if not exists internal_supplier_shipping_cents integer not null default 0 check (internal_supplier_shipping_cents >= 0),
  add column if not exists internal_supplier_tax_cents integer not null default 0 check (internal_supplier_tax_cents >= 0),
  add column if not exists internal_overhead_cents integer not null default 0 check (internal_overhead_cents >= 0),
  add column if not exists is_outsourced_order boolean not null default false,
  add column if not exists profitability_override_reason text,
  add column if not exists profitability_warnings jsonb not null default '[]'::jsonb,
  add column if not exists pricing_settings_snapshot jsonb;

alter table if exists public.custom_requests
  add column if not exists reorder_source_request_id uuid references public.custom_requests(id) on delete set null,
  add column if not exists reorder_price_lock jsonb;

create index if not exists custom_requests_reorder_source_idx
  on public.custom_requests (reorder_source_request_id)
  where reorder_source_request_id is not null;

comment on column public.custom_requests.reorder_price_lock is
  'Server-created snapshot of the completed source order customer pricing. Item/setup/discount pricing stays protected; fulfillment and tax may be recalculated.';

notify pgrst, 'reload schema';
