-- Moore Made Phase 6.43 — customer communication history
-- Run after Phase 5 messages and Phase 6.29 notification history.
-- Safe to run repeatedly. Existing test/resend email logs are backfilled once.

alter table public.message_entries
  add column if not exists notification_log_id uuid references public.notification_email_log(id) on delete set null;

create unique index if not exists message_entries_notification_log_idx
  on public.message_entries(notification_log_id)
  where notification_log_id is not null;

insert into public.message_threads (
  customer_user_id,
  request_id,
  subject,
  topic,
  status,
  customer_unread_count,
  admin_unread_count,
  last_message_at
)
select distinct on (r.id)
  r.customer_user_id,
  r.id,
  'MM-' || lpad(r.request_number::text, 6, '0') || ' · ' || r.product,
  'order',
  'open',
  0,
  0,
  l.sent_at
from public.notification_email_log l
join public.custom_requests r on r.id = l.request_id
where l.status = 'sent'
  and r.customer_user_id is not null
  and lower(l.recipient_email) = lower(r.email)
order by r.id, l.sent_at desc
on conflict (request_id) where request_id is not null do nothing;

insert into public.message_entries (
  thread_id,
  sender_user_id,
  sender_role,
  sender_display_name,
  body,
  is_internal,
  created_at,
  notification_log_id
)
select
  t.id,
  null,
  'system',
  'Moore Made email',
  'Previously sent email' || E'\n\n' || l.subject,
  false,
  l.sent_at,
  l.id
from public.notification_email_log l
join public.custom_requests r on r.id = l.request_id
join public.message_threads t on t.request_id = r.id
where l.status = 'sent'
  and r.customer_user_id is not null
  and lower(l.recipient_email) = lower(r.email)
on conflict (notification_log_id) where notification_log_id is not null do nothing;

update public.message_threads t
set last_message_at = latest.sent_at
from (
  select request_id, max(sent_at) as sent_at
  from public.notification_email_log
  where status = 'sent'
  group by request_id
) latest
where t.request_id = latest.request_id
  and latest.sent_at > t.last_message_at;

notify pgrst, 'reload schema';

