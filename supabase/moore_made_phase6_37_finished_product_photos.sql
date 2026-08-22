-- Moore Made Phase 6.37: finished product photos
-- Run AFTER Phase 6.30+ / 6.29 notification history.
-- Safe to run repeatedly. Does not delete existing order data.

alter table public.custom_requests
  add column if not exists finished_photo_token uuid default gen_random_uuid();

update public.custom_requests
set finished_photo_token = gen_random_uuid()
where finished_photo_token is null;

alter table public.custom_requests
  alter column finished_photo_token set default gen_random_uuid(),
  alter column finished_photo_token set not null;

create unique index if not exists custom_requests_finished_photo_token_idx
  on public.custom_requests (finished_photo_token);

create table if not exists public.order_finished_photos (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text,
  size_bytes bigint,
  sort_order integer not null default 0,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists order_finished_photos_request_idx
  on public.order_finished_photos (request_id, sort_order, created_at);

alter table public.order_finished_photos enable row level security;

insert into storage.buckets (id, name, public, file_size_limit)
values ('finished-product-files', 'finished-product-files', false, 20971520)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

-- Add this email type to the existing resend/audit history.
alter table public.notification_email_log
  drop constraint if exists notification_email_log_type_check;

alter table public.notification_email_log
  add constraint notification_email_log_type_check
  check (notification_type in (
    'quote_approval',
    'order_received',
    'payment_receipt',
    'production_update',
    'ready',
    'shipped',
    'finished_photos',
    'general'
  ));

comment on table public.order_finished_photos is
  'Admin-uploaded photos of the completed physical order. Visible to the linked customer account and through the order private finished-photo token.';

notify pgrst, 'reload schema';
