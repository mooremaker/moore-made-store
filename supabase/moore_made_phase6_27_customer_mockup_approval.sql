-- Moore Made Phase 6.27
-- Freeze the current customer/admin mockup document into each quote revision
-- so the exact design presented for approval does not change later.

alter table public.quotes
  add column if not exists mockup_snapshot jsonb;

alter table public.quote_revisions
  add column if not exists mockup_snapshot jsonb;

comment on column public.quotes.mockup_snapshot is
  'Frozen Mockup Studio/customer customization document presented with the current quote approval.';

comment on column public.quote_revisions.mockup_snapshot is
  'Frozen mockup document for this historical quote revision.';
