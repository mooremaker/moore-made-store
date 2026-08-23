-- Moore Made Phase 6.62
-- Customer receipt references follow the order reference.
-- Example: order MM-123456 -> first receipt MM-R-123456.
-- Additional payments use MM-R-123456-2, MM-R-123456-3, and so on.
-- Run once in Supabase SQL Editor after Phase 6.61.

alter table public.payments
  add column if not exists receipt_order_number bigint,
  add column if not exists receipt_payment_sequence integer;

-- Preserve historical payments while assigning their order-linked display identity.
with ranked as (
  select
    p.id,
    r.request_number,
    row_number() over (
      partition by p.request_id
      order by coalesce(p.paid_at, p.created_at), p.created_at, p.id
    )::integer as payment_sequence
  from public.payments p
  join public.custom_requests r on r.id = p.request_id
  where p.status in ('paid', 'voided')
)
update public.payments p
set
  receipt_order_number = ranked.request_number,
  receipt_payment_sequence = ranked.payment_sequence
from ranked
where p.id = ranked.id
  and (p.receipt_order_number is null or p.receipt_payment_sequence is null);

create unique index if not exists payments_order_receipt_sequence_unique
  on public.payments(request_id, receipt_payment_sequence)
  where receipt_payment_sequence is not null;

create or replace function public.assign_moore_made_payment_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' then
    if new.receipt_number is null then
      new.receipt_number := public.next_moore_made_receipt_number();
    end if;
    if new.receipt_token is null then
      new.receipt_token := gen_random_uuid();
    end if;
    if new.receipt_order_number is null then
      select request_number into new.receipt_order_number
      from public.custom_requests
      where id = new.request_id;
    end if;
    if new.receipt_payment_sequence is null then
      perform pg_advisory_xact_lock(hashtext(new.request_id::text));
      select coalesce(max(receipt_payment_sequence), 0) + 1
      into new.receipt_payment_sequence
      from public.payments
      where request_id = new.request_id
        and status in ('paid', 'voided')
        and id <> new.id;
    end if;
  end if;
  return new;
end;
$$;

-- Six digits remain the normal public format. If that pool is ever heavily
-- occupied, generation automatically expands to seven digits instead of failing.
create or replace function public.next_moore_made_order_number()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate bigint;
  attempt integer;
begin
  perform pg_advisory_xact_lock(604501);
  for attempt in 1..200 loop
    candidate := floor(random() * 900000)::bigint + 100000;
    if not exists (select 1 from public.custom_requests where request_number = candidate) then
      return candidate;
    end if;
  end loop;
  for attempt in 1..200 loop
    candidate := floor(random() * 9000000)::bigint + 1000000;
    if not exists (select 1 from public.custom_requests where request_number = candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'Could not allocate a unique Moore Made order number';
end;
$$;

revoke all on function public.next_moore_made_order_number() from public;
grant execute on function public.next_moore_made_order_number() to service_role;

comment on column public.payments.receipt_order_number is
  'Permanent copy of the Moore Made order number used in the customer receipt reference.';
comment on column public.payments.receipt_payment_sequence is
  'Payment sequence within the order. First receipt has no visible suffix; later receipts use -2, -3, etc.';

notify pgrst, 'reload schema';

