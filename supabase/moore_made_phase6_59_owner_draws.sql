-- Moore Made Phase 6.59 — owner draws / member distributions
-- Run once in Supabase after the existing funding-ledger migrations.

begin;

alter table public.business_funding_entries
  drop constraint if exists business_funding_entries_entry_type_check;

alter table public.business_funding_entries
  add constraint business_funding_entries_entry_type_check check (entry_type in (
    'owner_contribution',
    'owner_draw',
    'loan_received',
    'loan_repayment',
    'reimbursement_due',
    'reimbursement_paid',
    'equity_investment',
    'gift_received',
    'needs_classification'
  ));

comment on table public.business_funding_entries is
  'Private Moore Made owner/funding ledger. Owner draws are member distributions, not operating expenses, and entries are voided instead of deleted.';

commit;
