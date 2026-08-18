-- Moore Made Phase 6.12
-- Private owner/family/external funding ledger + supporting documents.
-- Run once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.business_funding_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  party_name text not null,
  party_kind text not null check (party_kind in ('member','family','external')),
  entry_type text not null check (entry_type in (
    'owner_contribution',
    'loan_received',
    'loan_repayment',
    'reimbursement_due',
    'reimbursement_paid',
    'equity_investment',
    'needs_classification'
  )),
  amount_cents bigint not null check (amount_cents > 0),
  payment_method text,
  reference text,
  note text,
  ownership_percent numeric(5,2) check (ownership_percent is null or (ownership_percent >= 0 and ownership_percent <= 100)),
  recorded_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  created_at timestamptz not null default now()
);

create index if not exists business_funding_entries_date_idx on public.business_funding_entries(entry_date desc, created_at desc);
create index if not exists business_funding_entries_party_idx on public.business_funding_entries(lower(party_name));

alter table public.business_funding_entries enable row level security;

create table if not exists public.business_funding_documents (
  id uuid primary key default gen_random_uuid(),
  funding_entry_id uuid not null references public.business_funding_entries(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists business_funding_documents_entry_idx on public.business_funding_documents(funding_entry_id);
alter table public.business_funding_documents enable row level security;

insert into storage.buckets (id, name, public, file_size_limit)
values ('business-funding-documents', 'business-funding-documents', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

comment on table public.business_funding_entries is 'Private Moore Made funding ledger. Entries are voided instead of deleted to preserve an audit trail.';
