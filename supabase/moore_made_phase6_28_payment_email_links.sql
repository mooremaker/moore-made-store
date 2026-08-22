-- Moore Made Phase 6.28: emailed secure payment links
-- Run AFTER Phase 6.26 (and Phase 6.27 if you are using the mockup approval upgrade).
-- Safe to run repeatedly. Does not delete existing data.

alter table public.payment_share_links
  add column if not exists recipient_email text,
  add column if not exists emailed_at timestamptz,
  add column if not exists email_status text,
  add column if not exists email_message_id text;

alter table public.payment_share_links drop constraint if exists payment_share_links_email_status_check;
alter table public.payment_share_links
  add constraint payment_share_links_email_status_check
  check (email_status is null or email_status in ('sent','failed'));

create index if not exists payment_share_links_recipient_idx
  on public.payment_share_links (lower(recipient_email), created_at desc)
  where recipient_email is not null;

notify pgrst, 'reload schema';
