-- Apply to a separate test database before testing draft saves or approval.
-- This file does not backfill or change existing orders.
begin;

alter table public.quotes add column if not exists personal_email_message text;
comment on column public.quotes.personal_email_message is
  'Admin approval email message, saved with the draft; separate from customer quote notes.';

create or replace function public.sync_quote_response_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      update public.custom_requests
      set status = 'approved'
      where id = new.request_id
        and status in ('new', 'reviewing', 'quote_sent', 'awaiting_payment');
    elsif new.status = 'changes_requested' then
      update public.custom_requests
      set status = 'reviewing'
      where id = new.request_id
        and status in ('new', 'reviewing', 'quote_sent', 'awaiting_payment', 'approved');
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_quote_response_order_status() from public;
drop trigger if exists quotes_sync_response_order_status on public.quotes;
create trigger quotes_sync_response_order_status
  after update of status on public.quotes
  for each row execute function public.sync_quote_response_order_status();

commit;
