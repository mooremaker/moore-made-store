-- Moore Made Phase 6.30
-- Artwork-rights acknowledgments + admin review + customer Shop mockups as proof source.

alter table public.custom_requests
  add column if not exists artwork_rights_accepted boolean not null default false,
  add column if not exists artwork_rights_accepted_at timestamptz,
  add column if not exists artwork_rights_policy_version text,
  add column if not exists artwork_rights_snapshot jsonb,
  add column if not exists artwork_rights_review_status text not null default 'not_reviewed',
  add column if not exists artwork_rights_review_note text,
  add column if not exists artwork_rights_reviewed_at timestamptz;

alter table public.custom_requests drop constraint if exists custom_requests_artwork_rights_review_status_check;
alter table public.custom_requests
  add constraint custom_requests_artwork_rights_review_status_check
  check (artwork_rights_review_status in ('not_reviewed','customer_attested','permission_requested','verified','declined'));

alter table public.quotes
  add column if not exists artwork_rights_confirmed_at timestamptz,
  add column if not exists artwork_rights_policy_version text,
  add column if not exists artwork_rights_snapshot jsonb;

alter table public.quote_revisions
  add column if not exists artwork_rights_confirmed_at timestamptz,
  add column if not exists artwork_rights_policy_version text,
  add column if not exists artwork_rights_snapshot jsonb;

create index if not exists custom_requests_artwork_rights_review_status_idx
  on public.custom_requests(artwork_rights_review_status);
