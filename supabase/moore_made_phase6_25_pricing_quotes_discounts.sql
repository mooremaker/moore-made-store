-- Moore Made Phase 6.25: quote profitability, revisions, and discount codes
-- Run once in Supabase after the earlier Moore Made migrations.

create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  description text,
  kind text not null check (kind in ('percent','fixed')),
  percent_off numeric(5,2),
  amount_off_cents integer,
  min_order_cents integer not null default 0 check (min_order_cents >= 0),
  max_uses integer check (max_uses is null or max_uses > 0),
  per_customer_limit integer check (per_customer_limit is null or per_customer_limit > 0),
  starts_at timestamptz,
  expires_at timestamptz,
  active boolean not null default true,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discount_codes_value_check check (
    (kind = 'percent' and percent_off is not null and percent_off > 0 and percent_off <= 100 and amount_off_cents is null)
    or
    (kind = 'fixed' and amount_off_cents is not null and amount_off_cents > 0 and percent_off is null)
  )
);

create unique index if not exists discount_codes_code_upper_unique on public.discount_codes (upper(code));
create index if not exists discount_codes_active_idx on public.discount_codes (active, retired_at, expires_at);

create or replace function public.normalize_discount_code()
returns trigger language plpgsql as $$
begin
  new.code = upper(trim(new.code));
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists discount_codes_normalize on public.discount_codes;
create trigger discount_codes_normalize
before insert or update on public.discount_codes
for each row execute function public.normalize_discount_code();

alter table public.custom_requests
  add column if not exists requested_discount_code text;

alter table public.quotes
  add column if not exists manual_discount_cents integer not null default 0,
  add column if not exists promo_discount_cents integer not null default 0,
  add column if not exists discount_code_id uuid references public.discount_codes(id) on delete set null,
  add column if not exists applied_discount_code text,
  add column if not exists internal_supply_cost_cents integer not null default 0,
  add column if not exists internal_print_cost_cents integer not null default 0,
  add column if not exists internal_packaging_cost_cents integer not null default 0,
  add column if not exists internal_shipping_cost_cents integer not null default 0,
  add column if not exists internal_payment_fee_cents integer not null default 0,
  add column if not exists internal_other_cost_cents integer not null default 0,
  add column if not exists labor_hours numeric(8,2) not null default 0,
  add column if not exists labor_rate_cents integer not null default 1000,
  add column if not exists labor_cost_cents integer not null default 0,
  add column if not exists internal_total_cost_cents integer not null default 0,
  add column if not exists estimated_profit_cents integer not null default 0,
  add column if not exists estimated_margin_basis_points integer not null default 0,
  add column if not exists revision_number integer not null default 1,
  add column if not exists revision_reason text;

-- Existing discounts were manual discounts before promo codes existed.
update public.quotes
set manual_discount_cents = discount_cents
where manual_discount_cents = 0 and promo_discount_cents = 0 and discount_cents > 0;

create table if not exists public.quote_revisions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  revision_number integer not null,
  status text not null default 'sent' check (status in ('sent','approved','declined','changes_requested','expired')),
  revision_reason text,
  line_items jsonb not null default '[]'::jsonb,
  setup_fee_cents integer not null default 0,
  shipping_cents integer not null default 0,
  tax_cents integer not null default 0,
  manual_discount_cents integer not null default 0,
  promo_discount_cents integer not null default 0,
  discount_cents integer not null default 0,
  applied_discount_code text,
  subtotal_cents integer not null default 0,
  total_cents integer not null default 0,
  payment_terms text not null default 'full',
  deposit_amount_cents integer,
  internal_supply_cost_cents integer not null default 0,
  internal_print_cost_cents integer not null default 0,
  internal_packaging_cost_cents integer not null default 0,
  internal_shipping_cost_cents integer not null default 0,
  internal_payment_fee_cents integer not null default 0,
  internal_other_cost_cents integer not null default 0,
  labor_hours numeric(8,2) not null default 0,
  labor_rate_cents integer not null default 1000,
  labor_cost_cents integer not null default 0,
  internal_total_cost_cents integer not null default 0,
  estimated_profit_cents integer not null default 0,
  estimated_margin_basis_points integer not null default 0,
  proof_version integer not null default 1,
  sent_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (quote_id, revision_number)
);

create index if not exists quote_revisions_quote_idx on public.quote_revisions (quote_id, revision_number desc);

create table if not exists public.discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  discount_code_id uuid not null references public.discount_codes(id) on delete restrict,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  customer_email text not null,
  discount_cents integer not null check (discount_cents >= 0),
  redeemed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (discount_code_id, quote_id)
);

create index if not exists discount_redemptions_code_idx on public.discount_redemptions (discount_code_id, redeemed_at desc);
create index if not exists discount_redemptions_customer_idx on public.discount_redemptions (discount_code_id, lower(customer_email));

alter table public.discount_codes enable row level security;
alter table public.quote_revisions enable row level security;
alter table public.discount_redemptions enable row level security;

revoke all on table public.discount_codes from anon, authenticated;
revoke all on table public.quote_revisions from anon, authenticated;
revoke all on table public.discount_redemptions from anon, authenticated;

notify pgrst, 'reload schema';
