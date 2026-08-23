-- Moore Made Phase 6.45: non-sequential six-digit public references
-- Run once after the existing order and payment migrations.
--
-- These numbers are customer-facing references only. UUID primary keys,
-- timestamps, payment IDs, and immutable history remain the audit trail.

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
  -- Serialize generation so two simultaneous orders cannot receive the same
  -- candidate before either transaction commits.
  perform pg_advisory_xact_lock(604501);

  for attempt in 1..100 loop
    candidate := floor(random() * 900000)::bigint + 100000;
    if not exists (
      select 1 from public.custom_requests where request_number = candidate
    ) then
      return candidate;
    end if;
  end loop;

  raise exception 'Could not allocate a unique Moore Made order number';
end;
$$;

revoke all on function public.next_moore_made_order_number() from public;
grant execute on function public.next_moore_made_order_number() to service_role;

create or replace function public.next_moore_made_receipt_number()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate bigint;
  attempt integer;
begin
  perform pg_advisory_xact_lock(604502);

  for attempt in 1..100 loop
    candidate := floor(random() * 900000)::bigint + 100000;
    if not exists (
      select 1 from public.payments where receipt_number = candidate
    ) then
      return candidate;
    end if;
  end loop;

  raise exception 'Could not allocate a unique Moore Made receipt number';
end;
$$;

revoke all on function public.next_moore_made_receipt_number() from public;
grant execute on function public.next_moore_made_receipt_number() to service_role;

-- Retire the public sequential identity. The UUID remains the internal primary
-- key and every new order receives one permanent MM-###### reference.
alter table public.custom_requests
  alter column request_number drop identity if exists;

alter table public.custom_requests
  alter column request_number set default public.next_moore_made_order_number();

-- Replace early sequential references so the current customer/admin documents
-- use the same non-sequential six-digit format. Re-running this file does not
-- change references that have already been converted.
update public.custom_requests
set request_number = public.next_moore_made_order_number()
where request_number between 1 and 99999;

-- Paid transactions receive a permanent MM-R-###### receipt reference. The
-- UUID receipt token remains the private URL credential and must not be
-- replaced by this display number.
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
  end if;
  return new;
end;
$$;

update public.payments
set receipt_number = public.next_moore_made_receipt_number()
where receipt_number between 1 and 99999;

comment on column public.custom_requests.request_number is
  'Permanent unique six-digit random customer reference displayed as MM-######.';

comment on column public.payments.receipt_number is
  'Permanent unique six-digit random receipt reference displayed as MM-R-######.';

notify pgrst, 'reload schema';
