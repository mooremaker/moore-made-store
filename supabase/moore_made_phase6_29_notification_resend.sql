-- Moore Made Phase 6.29: notification email resend/audit history
-- Run AFTER Phase 6.28. Safe to run repeatedly. Does not delete existing data.

create table if not exists public.notification_email_log (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete set null,
  notification_type text not null,
  recipient_email text not null,
  subject text not null,
  status text not null default 'sent',
  provider_message_id text,
  error_message text,
  created_by uuid,
  sent_at timestamptz not null default now()
);

alter table public.notification_email_log drop constraint if exists notification_email_log_type_check;
alter table public.notification_email_log
  add constraint notification_email_log_type_check
  check (notification_type in ('quote_approval','order_received','payment_receipt','production_update','ready','shipped','general'));

alter table public.notification_email_log drop constraint if exists notification_email_log_status_check;
alter table public.notification_email_log
  add constraint notification_email_log_status_check
  check (status in ('sent','failed'));

create index if not exists notification_email_log_request_idx
  on public.notification_email_log (request_id, sent_at desc);

create index if not exists notification_email_log_quote_idx
  on public.notification_email_log (quote_id, sent_at desc)
  where quote_id is not null;

alter table public.notification_email_log enable row level security;

comment on table public.notification_email_log is
  'Admin-side audit trail for customer/order notification email sends and resends.';

notify pgrst, 'reload schema';
