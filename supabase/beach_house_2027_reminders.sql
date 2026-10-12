-- Private, opt-in trip reminder records. Only the server service role can access them.
create table if not exists public.beach_house_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  status text not null default 'pending' check (status in ('pending','active','stopped')),
  confirmation_token text not null unique,
  confirmation_expires_at timestamptz not null,
  unsubscribe_token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.beach_house_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.beach_house_subscribers(id) on delete cascade,
  payment_date date not null,
  days_before integer not null check (days_before in (14,7,0)),
  locked_until timestamptz not null,
  sent_at timestamptz,
  provider_id text,
  unique(subscriber_id, payment_date, days_before)
);
alter table public.beach_house_subscribers enable row level security;
alter table public.beach_house_reminder_deliveries enable row level security;
revoke all on public.beach_house_subscribers, public.beach_house_reminder_deliveries from anon, authenticated;
grant all on public.beach_house_subscribers, public.beach_house_reminder_deliveries to service_role;
