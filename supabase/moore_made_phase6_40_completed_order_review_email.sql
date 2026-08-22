-- Moore Made Phase 6.40: one-time review invitation after order completion
-- Safe to run repeatedly. Does not delete or rewrite existing order data.

alter table public.custom_requests
  add column if not exists review_request_sent_at timestamptz;

comment on column public.custom_requests.review_request_sent_at is
  'When the one-time customer review invitation was successfully claimed and sent after this order was marked completed.';

notify pgrst, 'reload schema';
