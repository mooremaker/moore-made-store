-- Moore Made Phase 6.3: final-sale payment acknowledgments
-- Run AFTER Phase 6.2 / existing quote + payment migrations.
-- Safe to run repeatedly. Does not delete existing data.

create table if not exists public.order_policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  proof_version integer not null check (proof_version > 0),
  policy_version text not null,
  policy_title text not null,
  policy_snapshot jsonb not null,
  acceptance_source text not null default 'public_quote',
  user_agent text,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists order_policy_acceptances_quote_version_unique
  on public.order_policy_acceptances(quote_id, proof_version, policy_version);

create index if not exists order_policy_acceptances_request_idx
  on public.order_policy_acceptances(request_id, accepted_at desc);

alter table public.order_policy_acceptances enable row level security;
revoke all on table public.order_policy_acceptances from anon;
grant select on table public.order_policy_acceptances to authenticated;

drop policy if exists "customers read own policy acceptances" on public.order_policy_acceptances;
create policy "customers read own policy acceptances"
on public.order_policy_acceptances
for select to authenticated
using (
  exists (
    select 1
    from public.custom_requests r
    where r.id = order_policy_acceptances.request_id
      and r.customer_user_id = (select auth.uid())
  )
);

-- Writes are intentionally server-only via the Supabase secret key.
-- There is no anonymous/customer insert/update/delete policy.

notify pgrst, 'reload schema';
