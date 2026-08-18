-- Moore Made Phase 6.16 — Finance Command Center
-- Adds audit-safe expense voiding, business funding goals, and a durable finance audit trail.
-- Run once in the Supabase SQL Editor after the existing Phase 6 / 6.12 financial migrations.

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) Expenses: preserve the original record instead of deleting it.
-- -----------------------------------------------------------------------------
alter table public.business_expenses
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text;

create index if not exists business_expenses_active_date_idx
  on public.business_expenses(expense_date desc, created_at desc)
  where voided_at is null;

-- The earlier funding migration did not yet have a non-repayable family/outside gift type.
alter table public.business_funding_entries
  drop constraint if exists business_funding_entries_entry_type_check;
alter table public.business_funding_entries
  add constraint business_funding_entries_entry_type_check check (entry_type in (
    'owner_contribution',
    'loan_received',
    'loan_repayment',
    'reimbursement_due',
    'reimbursement_paid',
    'equity_investment',
    'gift_received',
    'needs_classification'
  ));

-- -----------------------------------------------------------------------------
-- 2) Business / equipment funding goals.
-- Goal balances are calculated from the append-only funding rows below.
-- -----------------------------------------------------------------------------
create table if not exists public.business_goals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  target_amount_cents bigint not null check (target_amount_cents > 0),
  priority text not null default 'medium' check (priority in ('critical','high','medium','future')),
  status text not null default 'saving' check (status in ('planned','saving','ready','purchased','paused','completed','cancelled')),
  target_date date,
  funding_source text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_goals_status_priority_idx
  on public.business_goals(status, priority, created_at desc)
  where voided_at is null;

create table if not exists public.business_goal_funding (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.business_goals(id) on delete restrict,
  entry_date date not null default current_date,
  direction text not null check (direction in ('allocate','withdraw')),
  amount_cents bigint not null check (amount_cents > 0),
  funding_source text,
  note text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists business_goal_funding_goal_idx
  on public.business_goal_funding(goal_id, entry_date desc, created_at desc);

create or replace function public.set_moore_made_goal_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists business_goals_set_updated_at on public.business_goals;
create trigger business_goals_set_updated_at
before update on public.business_goals
for each row execute function public.set_moore_made_goal_updated_at();

alter table public.business_goals enable row level security;
alter table public.business_goal_funding enable row level security;
revoke all on table public.business_goals from anon, authenticated;
revoke all on table public.business_goal_funding from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) Immutable finance audit journal.
-- This records before/after snapshots for the main finance tables. API/service-role
-- actions remain possible, while customer/authenticated clients have no access.
-- -----------------------------------------------------------------------------
create table if not exists public.business_finance_audit (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  entity_type text not null,
  entity_id text,
  action text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  before_data jsonb,
  after_data jsonb
);

create index if not exists business_finance_audit_time_idx
  on public.business_finance_audit(occurred_at desc);
create index if not exists business_finance_audit_entity_idx
  on public.business_finance_audit(entity_type, entity_id, occurred_at desc);

alter table public.business_finance_audit enable row level security;
revoke all on table public.business_finance_audit from anon, authenticated;

create or replace function public.moore_made_finance_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before_json jsonb;
  after_json jsonb;
  record_json jsonb;
  actor_text text;
  entity_text text;
  action_text text;
begin
  if tg_op = 'INSERT' then
    before_json := null;
    after_json := to_jsonb(new);
    record_json := after_json;
  elsif tg_op = 'UPDATE' then
    before_json := to_jsonb(old);
    after_json := to_jsonb(new);
    record_json := after_json;
  else
    before_json := to_jsonb(old);
    after_json := null;
    record_json := before_json;
  end if;

  entity_text := coalesce(record_json->>'id', record_json->>'storage_path', '');
  actor_text := coalesce(
    record_json->>'voided_by',
    record_json->>'updated_by',
    record_json->>'recorded_by',
    record_json->>'created_by',
    auth.uid()::text
  );

  if tg_op = 'UPDATE' and before_json->>'voided_at' is null and after_json->>'voided_at' is not null then
    action_text := 'void';
  elsif tg_op = 'UPDATE' and before_json->>'status' is distinct from after_json->>'status' then
    action_text := 'status_change';
  else
    action_text := lower(tg_op);
  end if;

  insert into public.business_finance_audit(entity_type, entity_id, action, actor_user_id, before_data, after_data)
  values (
    tg_table_name,
    nullif(entity_text, ''),
    action_text,
    case when actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then actor_text::uuid else null end,
    before_json,
    after_json
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Trigger helper: safe to re-run.
drop trigger if exists finance_audit_payments on public.payments;
create trigger finance_audit_payments
after insert or update or delete on public.payments
for each row execute function public.moore_made_finance_audit_trigger();

drop trigger if exists finance_audit_expenses on public.business_expenses;
create trigger finance_audit_expenses
after insert or update or delete on public.business_expenses
for each row execute function public.moore_made_finance_audit_trigger();

drop trigger if exists finance_audit_expense_receipts on public.business_expense_receipts;
create trigger finance_audit_expense_receipts
after insert or update or delete on public.business_expense_receipts
for each row execute function public.moore_made_finance_audit_trigger();

drop trigger if exists finance_audit_funding on public.business_funding_entries;
create trigger finance_audit_funding
after insert or update or delete on public.business_funding_entries
for each row execute function public.moore_made_finance_audit_trigger();

drop trigger if exists finance_audit_funding_documents on public.business_funding_documents;
create trigger finance_audit_funding_documents
after insert or update or delete on public.business_funding_documents
for each row execute function public.moore_made_finance_audit_trigger();

drop trigger if exists finance_audit_goals on public.business_goals;
create trigger finance_audit_goals
after insert or update or delete on public.business_goals
for each row execute function public.moore_made_finance_audit_trigger();

drop trigger if exists finance_audit_goal_funding on public.business_goal_funding;
create trigger finance_audit_goal_funding
after insert or update or delete on public.business_goal_funding
for each row execute function public.moore_made_finance_audit_trigger();

notify pgrst, 'reload schema';
commit;
