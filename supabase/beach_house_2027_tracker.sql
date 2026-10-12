create table if not exists public.beach_house_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null check (char_length(display_name) between 1 and 100),
  cash_app_name text not null check (char_length(cash_app_name) between 1 and 100),
  room_number integer not null check (room_number between 1 and 4),
  share_people integer not null check (share_people in (1,2)),
  status text not null default 'pending' check (status in ('pending','active','inactive')),
  checked_dates text[] not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists public.beach_house_contributions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.beach_house_members(user_id) on delete cascade,
  pool_key text not null check (pool_key in ('january','april')),
  amount_cents integer not null check (amount_cents between 1 and 96200),
  paid_date date not null,
  reference text check (char_length(reference) <= 120),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
create index if not exists beach_house_contributions_member on public.beach_house_contributions(member_id);
create unique index if not exists beach_house_contribution_reference on public.beach_house_contributions(pool_key,lower(reference)) where reference is not null and status <> 'rejected';
alter table public.beach_house_members enable row level security;
alter table public.beach_house_contributions enable row level security;
-- Data is only exposed through authenticated, owner-scoped server routes.
revoke all on public.beach_house_members, public.beach_house_contributions from anon, authenticated;
grant all on public.beach_house_members, public.beach_house_contributions to service_role;

create or replace function public.set_beach_house_check(p_user_id uuid, p_date text, p_checked boolean)
returns void language plpgsql set search_path = public as $$
begin
  if p_date not in ('2026-11-15','2026-12-15','2027-01-15','2027-02-15','2027-03-15') then raise exception 'Invalid payment date'; end if;
  update public.beach_house_members set checked_dates = case when p_checked then array(select distinct item from unnest(checked_dates || array[p_date]) item) else array_remove(checked_dates,p_date) end where user_id=p_user_id;
  if not found then raise exception 'Trip profile required'; end if;
end;
$$;
revoke all on function public.set_beach_house_check(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.set_beach_house_check(uuid,text,boolean) to service_role;

create or replace function public.approve_beach_house_member(p_user_id uuid, p_room integer, p_share_people integer)
returns void language plpgsql set search_path = public as $$
declare other_count integer; solo_count integer;
begin
  if p_room not between 1 and 4 or p_share_people not in (1,2) then raise exception 'Invalid room or split'; end if;
  -- Serialize room assignments; two concurrent approvals cannot overfill a room.
  perform pg_advisory_xact_lock(2027,p_room);
  select count(*), count(*) filter (where share_people=1) into other_count,solo_count from public.beach_house_members where room_number=p_room and status='active' and user_id<>p_user_id;
  if (p_share_people=1 and other_count>0) or (p_share_people=2 and (other_count>=2 or solo_count>0)) then raise exception 'This room already has its allocated shares'; end if;
  update public.beach_house_members set room_number=p_room,share_people=p_share_people,status='active' where user_id=p_user_id;
  if not found then raise exception 'Trip profile not found'; end if;
end;
$$;
revoke all on function public.approve_beach_house_member(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.approve_beach_house_member(uuid,integer,integer) to service_role;
