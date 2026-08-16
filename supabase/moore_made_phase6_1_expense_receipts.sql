-- Moore Made Phase 6.1: private expense receipt attachments
-- Run after moore_made_phase6_financials_receipts.sql.
-- Safe to run more than once.

create table if not exists public.business_expense_receipts (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.business_expenses(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists business_expense_receipts_expense_idx
  on public.business_expense_receipts(expense_id, created_at);

-- Keep receipt metadata private. Admin server routes use the Supabase secret/service key.
alter table public.business_expense_receipts enable row level security;
revoke all on table public.business_expense_receipts from anon;
revoke all on table public.business_expense_receipts from authenticated;

-- Private Supabase Storage bucket for receipt photos/PDFs.
insert into storage.buckets (id, name, public)
values ('business-expense-receipts', 'business-expense-receipts', false)
on conflict (id) do update set public = false;

notify pgrst, 'reload schema';
