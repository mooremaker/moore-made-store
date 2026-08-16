-- Moore Made Phase 5: customer/admin messaging inbox
-- Run AFTER Phase 3 Accounts + Security. Safe to run on the current Phase 4 database.

create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid references public.custom_requests(id) on delete cascade,
  subject text not null,
  topic text not null default 'other' check (topic in ('order','product','artwork','payment','shipping','other')),
  status text not null default 'open' check (status in ('open','resolved','archived')),
  assigned_admin_user_id uuid references auth.users(id) on delete set null,
  customer_unread_count integer not null default 0 check (customer_unread_count >= 0),
  admin_unread_count integer not null default 0 check (admin_unread_count >= 0),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One organized conversation per order. General conversations can be created as needed.
create unique index if not exists message_threads_one_per_order_idx
  on public.message_threads(request_id)
  where request_id is not null;
create index if not exists message_threads_customer_idx on public.message_threads(customer_user_id, last_message_at desc);
create index if not exists message_threads_admin_inbox_idx on public.message_threads(status, admin_unread_count desc, last_message_at desc);
create index if not exists message_threads_assignee_idx on public.message_threads(assigned_admin_user_id, status, last_message_at desc);

create table if not exists public.message_entries (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('customer','admin','system')),
  sender_display_name text not null,
  body text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists message_entries_thread_idx on public.message_entries(thread_id, created_at asc);

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.message_entries(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create index if not exists message_attachments_message_idx on public.message_attachments(message_id, created_at asc);

create or replace function public.set_moore_made_message_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists message_threads_set_updated_at on public.message_threads;
create trigger message_threads_set_updated_at before update on public.message_threads
for each row execute function public.set_moore_made_message_updated_at();

-- Private message attachment bucket. 20 MB per file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('message-files','message-files',false,20971520)
on conflict (id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit;

-- Customers read only their own conversation rows. Writes go through authenticated server routes.
alter table public.message_threads enable row level security;
alter table public.message_entries enable row level security;
alter table public.message_attachments enable row level security;

revoke all on table public.message_threads from anon;
revoke all on table public.message_entries from anon;
revoke all on table public.message_attachments from anon;

grant select on table public.message_threads to authenticated;
grant select on table public.message_entries to authenticated;
grant select on table public.message_attachments to authenticated;

drop policy if exists "customers read own message threads" on public.message_threads;
create policy "customers read own message threads" on public.message_threads
for select to authenticated
using (customer_user_id = (select auth.uid()));

drop policy if exists "customers read own visible messages" on public.message_entries;
create policy "customers read own visible messages" on public.message_entries
for select to authenticated
using (
  not is_internal
  and exists (
    select 1 from public.message_threads t
    where t.id = message_entries.thread_id
      and t.customer_user_id = (select auth.uid())
  )
);

drop policy if exists "customers read own message attachments" on public.message_attachments;
create policy "customers read own message attachments" on public.message_attachments
for select to authenticated
using (
  exists (
    select 1
    from public.message_entries m
    join public.message_threads t on t.id = m.thread_id
    where m.id = message_attachments.message_id
      and not m.is_internal
      and t.customer_user_id = (select auth.uid())
  )
);

-- Storage access follows the thread id in the first folder of each object path.
drop policy if exists "customers read own message files" on storage.objects;
create policy "customers read own message files"
on storage.objects for select to authenticated
using (
  bucket_id = 'message-files'
  and exists (
    select 1
    from public.message_entries m
    join public.message_threads t on t.id = m.thread_id
    where t.id::text = (storage.foldername(name))[1]
      and m.id::text = (storage.foldername(name))[2]
      and not m.is_internal
      and t.customer_user_id = (select auth.uid())
  )
);

-- No authenticated insert/update grants are intentionally added. All message mutations
-- are validated by Next.js routes using the user's session plus the server-side secret key.
notify pgrst, 'reload schema';
