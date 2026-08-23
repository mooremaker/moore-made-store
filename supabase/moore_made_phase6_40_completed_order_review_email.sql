-- Moore Made Phase 6.40: one-time review invitation after order completion
-- Safe to run repeatedly. Does not delete or rewrite existing order data.

alter table public.custom_requests
  add column if not exists review_request_sent_at timestamptz;

alter table public.custom_requests
  add column if not exists review_request_token uuid not null default gen_random_uuid();

create unique index if not exists custom_requests_review_request_token_unique
  on public.custom_requests(review_request_token);

comment on column public.custom_requests.review_request_sent_at is
  'When the one-time customer review invitation was successfully claimed and sent after this order was marked completed.';

comment on column public.custom_requests.review_request_token is
  'Private customer review-link credential. It pre-fills the completed order review without exposing an order id.';

notify pgrst, 'reload schema';
