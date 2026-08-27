-- Stores every externally sent mockup/proof set and its approval state.
create table if not exists public.mockup_review_sends (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  version integer not null,
  public_token uuid not null unique default gen_random_uuid(),
  recipient_emails text[] not null default '{}',
  note text,
  files jsonb not null default '[]'::jsonb,
  sent_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, version)
);

create index if not exists mockup_review_sends_request_id_idx on public.mockup_review_sends(request_id, sent_at desc);

alter table public.mockup_review_sends enable row level security;

create or replace function public.touch_mockup_review_send_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mockup_review_sends_touch_updated_at on public.mockup_review_sends;
create trigger mockup_review_sends_touch_updated_at
before update on public.mockup_review_sends
for each row execute function public.touch_mockup_review_send_updated_at();
