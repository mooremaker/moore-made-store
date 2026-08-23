-- Moore Made Phase 6.49: private year-to-date owner tax reserve estimate.
-- Run once after deploying the matching application update.

alter table public.business_settings
  add column if not exists income_tax_reserve_basis_points integer not null default 3000
  check (income_tax_reserve_basis_points between 0 and 6000);

comment on column public.business_settings.income_tax_reserve_basis_points is
  'Private planning percentage applied to estimated taxable business profit; not a filed tax calculation.';

notify pgrst, 'reload schema';
