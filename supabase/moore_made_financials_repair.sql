-- Moore Made — Financials / Receipts repair migration
-- Safe repair for databases where Phase 6 ran but earlier Phase 4 manual-payment
-- columns were skipped. This does not delete orders, payments, receipts, or expenses.

begin;

-- The Phase 6 admin screen expects the Phase 4 payments table to already exist.
do $$
begin
  if to_regclass('public.payments') is null then
    raise exception 'public.payments does not exist. Run the Phase 4 payments migration first.';
  end if;
end $$;

-- Columns used by manual/Cash App/cash payments and by the Financials dashboard.
alter table public.payments
  add column if not exists payment_method text not null default 'stripe',
  add column if not exists manual_reference text,
  add column if not exists manual_note text,
  add column if not exists recorded_by uuid,
  add column if not exists receipt_number bigint,
  add column if not exists receipt_token uuid;

update public.payments
set payment_method = 'stripe'
where payment_method is null or btrim(payment_method) = '';

-- Receipt identity / automatic receipt assignment.
create sequence if not exists public.moore_made_receipt_number_seq
  start with 1 increment by 1;

create unique index if not exists payments_receipt_number_unique
  on public.payments(receipt_number)
  where receipt_number is not null;

create unique index if not exists payments_receipt_token_unique
  on public.payments(receipt_token)
  where receipt_token is not null;

create or replace function public.assign_moore_made_payment_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' then
    if new.receipt_number is null then
      new.receipt_number := nextval('public.moore_made_receipt_number_seq');
    end if;
    if new.receipt_token is null then
      new.receipt_token := gen_random_uuid();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_assign_receipt on public.payments;
create trigger payments_assign_receipt
before insert or update of status on public.payments
for each row execute function public.assign_moore_made_payment_receipt();

-- Backfill receipt information for previously paid rows.
update public.payments
set
  receipt_number = coalesce(receipt_number, nextval('public.moore_made_receipt_number_seq')),
  receipt_token = coalesce(receipt_token, gen_random_uuid())
where status = 'paid'
  and (receipt_number is null or receipt_token is null);

-- Expense tracker. CREATE handles a missing table; ALTER handles a partially-created table.
create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  vendor text not null,
  category text not null default 'other',
  description text,
  amount_cents integer not null,
  payment_method text,
  note text,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_expenses
  add column if not exists expense_date date default current_date,
  add column if not exists vendor text,
  add column if not exists category text default 'other',
  add column if not exists description text,
  add column if not exists amount_cents integer,
  add column if not exists payment_method text,
  add column if not exists note text,
  add column if not exists recorded_by uuid,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create index if not exists business_expenses_date_idx
  on public.business_expenses(expense_date desc, created_at desc);

create index if not exists business_expenses_category_idx
  on public.business_expenses(category, expense_date desc);

create or replace function public.set_moore_made_expense_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists business_expenses_set_updated_at on public.business_expenses;
create trigger business_expenses_set_updated_at
before update on public.business_expenses
for each row execute function public.set_moore_made_expense_updated_at();

alter table public.business_expenses enable row level security;
revoke all on table public.business_expenses from anon;
revoke all on table public.business_expenses from authenticated;

-- Tell Supabase/PostgREST to see newly-added columns immediately.
notify pgrst, 'reload schema';

commit;

-- Health check: this should return ZERO rows when the Financials schema is complete.
with required(table_name, column_name) as (
  values
    ('payments','id'),
    ('payments','request_id'),
    ('payments','quote_id'),
    ('payments','payment_kind'),
    ('payments','amount_cents'),
    ('payments','currency'),
    ('payments','status'),
    ('payments','payment_method'),
    ('payments','manual_reference'),
    ('payments','paid_at'),
    ('payments','created_at'),
    ('payments','receipt_number'),
    ('payments','receipt_token'),
    ('business_expenses','id'),
    ('business_expenses','expense_date'),
    ('business_expenses','vendor'),
    ('business_expenses','category'),
    ('business_expenses','description'),
    ('business_expenses','amount_cents'),
    ('business_expenses','payment_method'),
    ('business_expenses','note'),
    ('business_expenses','recorded_by'),
    ('business_expenses','created_at'),
    ('business_expenses','updated_at')
)
select r.table_name, r.column_name as missing_column
from required r
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = r.table_name
 and c.column_name = r.column_name
where c.column_name is null
order by r.table_name, r.column_name;
