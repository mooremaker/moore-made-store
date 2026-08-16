-- Moore Made Phase 6: printable payment receipts + admin financials
-- Run after the existing Phase 4 payment migrations. Safe to run on the current database.

-- Durable receipt identity. A receipt number/token is assigned only when a payment becomes paid.
create sequence if not exists public.moore_made_receipt_number_seq start with 1 increment by 1;

alter table public.payments
  add column if not exists receipt_number bigint,
  add column if not exists receipt_token uuid;

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

-- Backfill receipts for any payments that were recorded before this migration.
update public.payments
set
  receipt_number = coalesce(receipt_number, nextval('public.moore_made_receipt_number_seq')),
  receipt_token = coalesce(receipt_token, gen_random_uuid())
where status = 'paid'
  and (receipt_number is null or receipt_token is null);

-- Operational expense tracker for the private admin Financials tab.
create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  vendor text not null,
  category text not null default 'other'
    check (category in ('materials','shipping','equipment','software','advertising','fees','office','travel','other')),
  description text,
  amount_cents integer not null check (amount_cents > 0),
  payment_method text,
  note text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_expenses_date_idx on public.business_expenses(expense_date desc, created_at desc);
create index if not exists business_expenses_category_idx on public.business_expenses(category, expense_date desc);

create or replace function public.set_moore_made_expense_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists business_expenses_set_updated_at on public.business_expenses;
create trigger business_expenses_set_updated_at
before update on public.business_expenses
for each row execute function public.set_moore_made_expense_updated_at();

-- Expenses are never exposed to anonymous/customer API access. Admin server routes use the secret key.
alter table public.business_expenses enable row level security;
revoke all on table public.business_expenses from anon;
revoke all on table public.business_expenses from authenticated;

notify pgrst, 'reload schema';
