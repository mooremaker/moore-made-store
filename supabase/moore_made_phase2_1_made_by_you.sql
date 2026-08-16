-- Run this if you already ran moore_made_phase2.sql
alter table public.custom_requests add column if not exists sms_consent boolean not null default false;
alter table public.custom_requests add column if not exists sms_consent_at timestamptz;

create table if not exists public.showcase_posts (
  id uuid primary key default gen_random_uuid(), submission_token uuid not null default gen_random_uuid(), customer_name text not null, business_name text, email text not null, product text not null, rating integer not null check (rating between 1 and 5), review text not null, caption text, social_handle text, display_permission boolean not null default false, photo_paths text[] not null default '{}', status text not null default 'pending' check (status in ('pending','approved','rejected')), approved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.showcase_posts enable row level security;
create or replace function public.set_showcase_post_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists showcase_posts_set_updated_at on public.showcase_posts;
create trigger showcase_posts_set_updated_at before update on public.showcase_posts for each row execute function public.set_showcase_post_updated_at();
insert into storage.buckets (id, name, public, file_size_limit) values ('showcase-files','showcase-files',false,15728640) on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit;
