-- Moore Made Phase 6.26: structured ordering, admin pricing, payment share links,
-- payment corrections, and tax calculation metadata.
-- Run AFTER moore_made_phase6_25_pricing_quotes_discounts.sql.
-- Safe to run once; most statements are idempotent.

-- Structured customer order builder data + fulfillment address.
alter table public.custom_requests
  add column if not exists order_items jsonb not null default '[]'::jsonb,
  add column if not exists shipping_address jsonb;

-- Private product-pricing defaults used only by Admin/quote calculations.
create table if not exists public.product_pricing (
  product_slug text primary key,
  product_name text not null,
  active boolean not null default true,
  blank_cost_cents integer not null default 0 check (blank_cost_cents >= 0),
  print_cost_cents integer not null default 0 check (print_cost_cents >= 0),
  packaging_cost_cents integer not null default 0 check (packaging_cost_cents >= 0),
  default_labor_hours numeric(8,2) not null default 0 check (default_labor_hours >= 0),
  labor_rate_cents integer not null default 1500 check (labor_rate_cents >= 0),
  target_margin_basis_points integer not null default 5000 check (target_margin_basis_points >= 0 and target_margin_basis_points < 10000),
  tax_code text not null default 'txcd_99999999',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_product_pricing_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists product_pricing_set_updated_at on public.product_pricing;
create trigger product_pricing_set_updated_at
before update on public.product_pricing
for each row execute function public.set_product_pricing_updated_at();

-- Singleton business settings. The pickup address is also the default customer
-- location used for pickup tax calculations.
create table if not exists public.business_settings (
  id text primary key default 'default',
  default_labor_rate_cents integer not null default 1500 check (default_labor_rate_cents >= 0),
  minimum_labor_hours numeric(8,2) not null default 1 check (minimum_labor_hours >= 0),
  pickup_address jsonb,
  default_tax_code text not null default 'txcd_99999999',
  shipping_tax_code text not null default 'txcd_92010001',
  updated_at timestamptz not null default now()
);

insert into public.business_settings (id)
values ('default')
on conflict (id) do nothing;

-- Quote tax mode + Stripe Tax calculation snapshot.
alter table public.quotes
  add column if not exists tax_mode text not null default 'manual',
  add column if not exists stripe_tax_calculation_id text,
  add column if not exists tax_calculated_at timestamptz,
  add column if not exists tax_exempt_reason text,
  add column if not exists tax_breakdown jsonb,
  add column if not exists tax_input_fingerprint text;

alter table public.quotes drop constraint if exists quotes_tax_mode_check;
alter table public.quotes
  add constraint quotes_tax_mode_check
  check (tax_mode in ('automatic','manual','exempt'));

-- Secure shareable payment links. Only a hash of the URL token is stored.
create table if not exists public.payment_share_links (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  token_hash text not null unique,
  label text,
  active boolean not null default true,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists payment_share_links_quote_idx
  on public.payment_share_links (quote_id, active, created_at desc);

-- Payment audit/correction fields + separate payer identity.
alter table public.payments
  add column if not exists payer_name text,
  add column if not exists payer_email text,
  add column if not exists payment_share_link_id uuid references public.payment_share_links(id) on delete set null,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists voided_by uuid;

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('pending','paid','failed','refunded','voided'));

-- Private admin/server-only tables.
alter table public.product_pricing enable row level security;
alter table public.business_settings enable row level security;
alter table public.payment_share_links enable row level security;

revoke all on table public.product_pricing from anon, authenticated;
revoke all on table public.business_settings from anon, authenticated;
revoke all on table public.payment_share_links from anon, authenticated;

notify pgrst, 'reload schema';
