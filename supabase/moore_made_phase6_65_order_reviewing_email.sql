-- Records the one-time customer acknowledgement sent when an order first enters Reviewing.
alter table public.custom_requests
  add column if not exists reviewing_email_sent_at timestamptz;
