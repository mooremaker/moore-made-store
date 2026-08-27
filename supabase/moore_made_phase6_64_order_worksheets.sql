-- Reusable, customer-shareable worksheets for any custom order.
create extension if not exists pgcrypto;

create table if not exists public.order_worksheets (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.custom_requests(id) on delete cascade,
  public_token uuid not null unique default gen_random_uuid(),
  title text not null default 'Employee shirt roster',
  instructions text,
  columns jsonb not null default '[{"id":"employee_name","label":"Employee name","required":true,"customerVisible":true},{"id":"shirt_size","label":"Shirt size","required":true,"customerVisible":true},{"id":"back_name_requested","label":"Last name on back?","customerVisible":true},{"id":"back_name","label":"Last name for back","customerVisible":true}]'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  submitted_file_paths jsonb not null default '[]'::jsonb,
  is_open boolean not null default true,
  last_sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_worksheets_request_idx on public.order_worksheets(request_id);
create index if not exists order_worksheets_token_idx on public.order_worksheets(public_token);

alter table public.order_worksheets enable row level security;
-- This feature is accessed through authenticated server routes only. Keeping RLS
-- enabled with no browser-direct policy prevents direct client access without
-- depending on an optional legacy public.is_admin() helper function.

create or replace function public.touch_order_worksheet_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists order_worksheets_touch_updated_at on public.order_worksheets;
create trigger order_worksheets_touch_updated_at before update on public.order_worksheets
for each row execute function public.touch_order_worksheet_updated_at();
