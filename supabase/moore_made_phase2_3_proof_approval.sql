-- Moore Made Phase 2C: proof + quote approval and fulfillment notifications
-- Run this AFTER Phase 2, Phase 2.1, and Phase 2B.

-- Quote proof / revision fields.
alter table public.quotes
  add column if not exists proof_paths text[] not null default '{}',
  add column if not exists proof_notes text,
  add column if not exists proof_version integer not null default 1,
  add column if not exists customer_change_request text;

-- Allow a customer to request changes instead of treating that as a hard decline.
alter table public.quotes drop constraint if exists quotes_status_check;
alter table public.quotes
  add constraint quotes_status_check
  check (status in ('draft','sent','approved','declined','changes_requested','expired'));

-- Fulfillment fields and shipped status.
alter table public.custom_requests
  add column if not exists tracking_number text,
  add column if not exists tracking_url text,
  add column if not exists fulfillment_note text,
  add column if not exists fulfillment_notified_at timestamptz;

alter table public.custom_requests drop constraint if exists custom_requests_status_check;
alter table public.custom_requests
  add constraint custom_requests_status_check
  check (status in ('new','reviewing','quote_sent','approved','in_production','ready','shipped','completed','cancelled'));

-- Private proof/mockup files. 20 MB per file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('quote-proof-files', 'quote-proof-files', false, 20971520)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;
