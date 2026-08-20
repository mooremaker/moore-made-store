-- Moore Made — Estimated ship / pickup-ready dates
-- Safe additive migration. No rows are deleted or rebuilt.

begin;

alter table public.custom_requests
  add column if not exists estimated_fulfillment_date date,
  add column if not exists estimated_fulfillment_note text,
  add column if not exists estimated_fulfillment_notified_at timestamptz,
  add column if not exists estimated_fulfillment_notified_for_date date;

comment on column public.custom_requests.estimated_fulfillment_date is
  'Current customer-facing estimated ship date or pickup-ready date. Estimate only; not guaranteed.';
comment on column public.custom_requests.estimated_fulfillment_note is
  'Optional customer-facing note attached to the current production estimate.';
comment on column public.custom_requests.estimated_fulfillment_notified_at is
  'When Moore Made most recently emailed a production estimate to the customer.';
comment on column public.custom_requests.estimated_fulfillment_notified_for_date is
  'The estimated fulfillment date that was included in the most recent estimate email.';

notify pgrst, 'reload schema';
commit;
