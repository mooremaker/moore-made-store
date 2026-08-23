-- Moore Made Phase 6.48
-- Private, revocable supporter page and gift-interest inbox.
-- Run once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.support_page_settings (
  id text primary key default 'default' check (id = 'default'),
  enabled boolean not null default false,
  access_token uuid not null default gen_random_uuid() unique,
  expires_at timestamptz,
  phone text,
  contact_email text,
  funding_goal_cents bigint not null default 0 check (funding_goal_cents >= 0),
  headline text not null default 'Help Moore Made grow with confidence.',
  introduction text not null default 'Moore Made is building a dependable custom-goods business centered on thoughtful design, clear customer approval, profitable pricing, and careful production.',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.support_page_settings (id)
values ('default')
on conflict (id) do nothing;

alter table public.support_page_settings enable row level security;

create table if not exists public.support_inquiries (
  id uuid primary key default gen_random_uuid(),
  settings_id text not null default 'default' references public.support_page_settings(id) on delete restrict,
  name text not null,
  email text,
  phone text,
  preferred_contact text not null default 'either' check (preferred_contact in ('phone','email','either')),
  amount_range text,
  message text,
  help_requested boolean not null default true,
  gift_terms_acknowledged boolean not null default false,
  status text not null default 'new' check (status in ('new','contacted','completed','declined')),
  admin_note text,
  contacted_at timestamptz,
  admin_email_sent_at timestamptz,
  admin_email_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_inquiries_created_idx on public.support_inquiries(created_at desc);
create index if not exists support_inquiries_status_idx on public.support_inquiries(status, created_at desc);
alter table public.support_inquiries enable row level security;

comment on table public.support_page_settings is 'Private Moore Made gift-support page. The token is revocable and the page is never indexed.';
comment on table public.support_inquiries is 'Private support-interest inbox. Submissions are not payments or commitments.';
