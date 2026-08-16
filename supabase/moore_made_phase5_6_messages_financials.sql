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


-- Moore Made Phase 6: printable payment receipts + admin financials
-- Run after the existing Phase 4 payment migrations. Safe to run on the current database.

-- Durable receipt identity. A receipt number/token is assigned only when a payment becomes paid.
create sequence if not exists public.moore_made_receipt_number_seq start with 1 increment by 1;

alter table public.payments
  add column if not exists receipt_number bigint,
  add column if not exists receipt_token uuid;

create unique index if not exists payments_receipt_number_unique
  on public.payments(receipt_number)
  where receipt_number is not null;

create unique index if not exists payments_receipt_token_unique
  on public.payments(receipt_token)
  where receipt_token is not null;

create or replace function public.assign_moore_made_payment_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' then
    if new.receipt_number is null then
      new.receipt_number := nextval('public.moore_made_receipt_number_seq');
    end if;
    if new.receipt_token is null then
      new.receipt_token := gen_random_uuid();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_assign_receipt on public.payments;
create trigger payments_assign_receipt
before insert or update of status on public.payments
for each row execute function public.assign_moore_made_payment_receipt();

-- Backfill receipts for any payments that were recorded before this migration.
update public.payments
set
  receipt_number = coalesce(receipt_number, nextval('public.moore_made_receipt_number_seq')),
  receipt_token = coalesce(receipt_token, gen_random_uuid())
where status = 'paid'
  and (receipt_number is null or receipt_token is null);

-- Operational expense tracker for the private admin Financials tab.
create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  vendor text not null,
  category text not null default 'other'
    check (category in ('materials','shipping','equipment','software','advertising','fees','office','travel','other')),
  description text,
  amount_cents integer not null check (amount_cents > 0),
  payment_method text,
  note text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_expenses_date_idx on public.business_expenses(expense_date desc, created_at desc);
create index if not exists business_expenses_category_idx on public.business_expenses(category, expense_date desc);

create or replace function public.set_moore_made_expense_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists business_expenses_set_updated_at on public.business_expenses;
create trigger business_expenses_set_updated_at
before update on public.business_expenses
for each row execute function public.set_moore_made_expense_updated_at();

-- Expenses are never exposed to anonymous/customer API access. Admin server routes use the secret key.
alter table public.business_expenses enable row level security;
revoke all on table public.business_expenses from anon;
revoke all on table public.business_expenses from authenticated;

notify pgrst, 'reload schema';
