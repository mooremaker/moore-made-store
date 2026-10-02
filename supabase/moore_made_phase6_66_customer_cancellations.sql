-- Customer cancellation flow. Run after Phase 5 messages and Phase 6.65 mockup history.
begin;
create table if not exists public.customer_order_cancellations (
  request_id uuid primary key references public.custom_requests(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id),
  outcome text not null check (outcome in ('cancelled','review_requested')),
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.customer_order_cancellations enable row level security;
drop policy if exists "customers read own cancellations" on public.customer_order_cancellations;
create policy "customers read own cancellations" on public.customer_order_cancellations for select to authenticated using(customer_user_id = auth.uid());
grant select on public.customer_order_cancellations to authenticated;

create or replace function public.customer_cancel_order(p_request_id uuid, p_customer_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  r public.custom_requests%rowtype;
  existing public.customer_order_cancellations%rowtype;
  v_outcome text;
  v_thread uuid;
  v_direct boolean;
begin
  select * into r from public.custom_requests where id=p_request_id and customer_user_id=p_customer_id for update;
  if not found then raise exception 'Order is not available to this account.' using errcode='42501'; end if;
  select * into existing from public.customer_order_cancellations where request_id=r.id;
  if found then return jsonb_build_object('outcome',existing.outcome,'alreadyRecorded',true); end if;
  if r.status='cancelled' then return jsonb_build_object('outcome','cancelled','alreadyRecorded',true); end if;
  if r.status in ('shipped','completed') then raise exception 'Please contact Moore Made about this order.'; end if;
  if length(trim(coalesce(p_reason,'')))<3 or length(p_reason)>2000 then raise exception 'Add a short cancellation reason.'; end if;
  -- Lock related approvals before checking. Parent-lock triggers below serialize new approvals/payments.
  perform id from public.quotes where request_id=r.id for update;
  perform id from public.mockup_review_sends where request_id=r.id for update;
  v_direct := r.status in ('new','reviewing','quote_sent') and coalesce(r.amount_paid_cents,0)=0
    and coalesce(r.payment_status,'unpaid')='unpaid'
    and not exists(select 1 from public.quotes where request_id=r.id and status='approved')
    and not exists(select 1 from public.mockup_review_sends where request_id=r.id and approved_at is not null)
    and not exists(select 1 from public.payments where request_id=r.id and status in ('pending','paid'));
  v_outcome := case when v_direct then 'cancelled' else 'review_requested' end;
  if v_direct then
    update public.custom_requests set status='cancelled' where id=r.id;
    update public.quotes set status='expired' where request_id=r.id and status in ('draft','sent','changes_requested');
    update public.order_worksheets set is_open=false where request_id=r.id;
  end if;
  insert into public.customer_order_cancellations(request_id,customer_user_id,outcome,reason) values(r.id,p_customer_id,v_outcome,trim(p_reason));
  insert into public.message_threads(customer_user_id,request_id,subject,topic,status,admin_unread_count)
    values(p_customer_id,r.id,'MM-'||lpad(r.request_number::text,6,'0')||' · '||r.product,'order','open',1)
    on conflict(request_id) where request_id is not null do update set admin_unread_count=message_threads.admin_unread_count+1,status='open',last_message_at=now()
    returning id into v_thread;
  insert into public.message_entries(thread_id,sender_user_id,sender_role,sender_display_name,body,is_internal)
    values(v_thread,p_customer_id,'customer',r.customer_name,
      case when v_direct then 'Customer cancelled this unpaid, unapproved request.' else 'Customer requested cancellation. Admin review required; the order has not been cancelled and no refund has been issued.' end || E'\n\nReason: ' || trim(p_reason),false);
  return jsonb_build_object('outcome',v_outcome,'alreadyRecorded',false);
end;
$$;
revoke all on function public.customer_cancel_order(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.customer_cancel_order(uuid,uuid,text) to service_role;

-- Prevent old public links or concurrent approvals from reopening a cancelled request.
create or replace function public.guard_cancelled_order_action()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text;
begin
  select status into v_status from public.custom_requests where id=new.request_id for update;
  if v_status='cancelled' then raise exception 'This order has been cancelled.'; end if;
  return new;
end;
$$;
drop trigger if exists guard_cancelled_quote_approval on public.quotes;
create trigger guard_cancelled_quote_approval before insert or update on public.quotes for each row when (new.status='approved') execute function public.guard_cancelled_order_action();
drop trigger if exists guard_cancelled_mockup_approval on public.mockup_review_sends;
create trigger guard_cancelled_mockup_approval before insert or update on public.mockup_review_sends for each row when (new.approved_at is not null) execute function public.guard_cancelled_order_action();
drop trigger if exists guard_cancelled_payment on public.payments;
create trigger guard_cancelled_payment before insert or update on public.payments for each row when (new.status in ('pending','paid')) execute function public.guard_cancelled_order_action();
commit;
notify pgrst,'reload schema';
