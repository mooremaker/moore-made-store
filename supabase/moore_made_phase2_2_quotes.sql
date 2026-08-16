-- Moore Made Phase 2B: quotes and customer approval links
-- Run this AFTER Phase 2 and Phase 2.1.

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  public_token uuid not null default gen_random_uuid() unique,
  status text not null default 'draft' check (status in ('draft','sent','approved','declined','expired')),
  line_items jsonb not null default '[]'::jsonb,
  setup_fee_cents integer not null default 0 check (setup_fee_cents >= 0),
  shipping_cents integer not null default 0 check (shipping_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  notes text,
  valid_until date,
  sent_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quotes enable row level security;

create unique index if not exists quotes_request_id_unique on public.quotes(request_id);
create index if not exists quotes_public_token_idx on public.quotes(public_token);

create or replace function public.set_quote_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists quotes_set_updated_at on public.quotes;
create trigger quotes_set_updated_at
before update on public.quotes
for each row execute function public.set_quote_updated_at();
