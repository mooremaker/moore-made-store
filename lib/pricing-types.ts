export type ProductPricingRecord = {
  product_slug: string;
  product_name: string;
  active: boolean;
  blank_cost_cents: number;
  size_blank_costs?: Record<string, number>;
  size_customer_surcharges?: Record<string, number>;
  print_cost_cents: number;
  additional_location_cost_cents?: number;
  packaging_cost_cents: number;
  minimum_profit_per_item_cents?: number;
  default_labor_hours: number;
  labor_rate_cents: number;
  target_margin_basis_points: number;
  tax_code: string;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

export function priceForSize(size: string, baseCents: number, bySize?: Record<string, number> | null) {
  const saved = Number(bySize?.[size]);
  return Number.isFinite(saved) && saved >= 0 ? Math.round(saved) : Math.max(0, Math.round(baseCents || 0));
}

export type BusinessSettingsRecord = {
  id: string;
  default_labor_rate_cents: number;
  minimum_labor_hours: number;
  pickup_address: Record<string, string> | null;
  default_tax_code: string;
  shipping_tax_code: string;
  margin_1_9_basis_points?: number;
  margin_10_24_basis_points?: number;
  margin_25_49_basis_points?: number;
  margin_50_plus_basis_points?: number;
  minimum_margin_floor_basis_points?: number;
  standard_shirt_min_profit_cents?: number;
  outsourced_min_margin_basis_points?: number;
  overhead_basis_points?: number;
  payment_fee_basis_points?: number;
  payment_fee_fixed_cents?: number;
  default_shipping_charge_cents?: number;
  income_tax_reserve_basis_points?: number;
  labor_warning_minutes_per_piece?: number;
  weekly_sales_goal_cents?: number;
  weekly_profit_goal_cents?: number;
  weekly_owner_goal_cents?: number;
  weekly_reserve_goal_cents?: number;
  updated_at?: string;
};

export function recommendedRevenueForMargin(costCents: number, marginBasisPoints: number) {
  const cost = Math.max(0, Math.round(costCents || 0));
  const margin = Math.min(9500, Math.max(0, Math.round(marginBasisPoints || 0))) / 10000;
  if (cost <= 0) return 0;
  if (margin >= 1) return cost;
  return Math.ceil(cost / (1 - margin));
}

export function targetMarginForQuantity(quantity: number, settings?: BusinessSettingsRecord | null) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  if (qty <= 9) return Number(settings?.margin_1_9_basis_points ?? 5500);
  if (qty <= 24) return Number(settings?.margin_10_24_basis_points ?? 5000);
  if (qty <= 49) return Number(settings?.margin_25_49_basis_points ?? 4500);
  return Number(settings?.margin_50_plus_basis_points ?? 4250);
}

/** Bulk orders take more total time, but setup is only done once. */
export function suggestedLaborHoursForQuantity(quantity: number, minimumHours = 1) {
  let remaining = Math.max(1, Math.floor(Number(quantity) || 1)) - 1;
  let hours = Math.max(0, Number(minimumHours) || 0);
  const add = (pieces: number, hoursPerPiece: number) => {
    const used = Math.min(remaining, pieces);
    hours += used * hoursPerPiece;
    remaining -= used;
  };
  add(8, 0.12);
  add(15, 0.07);
  add(25, 0.05);
  if (remaining) hours += remaining * 0.035;
  return Math.round(hours * 100) / 100;
}

/** The standard-shirt profit floor tapers for bulk while retaining small-job protection. */
export function standardShirtMinProfitForQuantity(quantity: number, settings?: BusinessSettingsRecord | null) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const smallOrderFloor = Number(settings?.standard_shirt_min_profit_cents ?? 1200);
  if (qty <= 9) return smallOrderFloor;
  if (qty <= 24) return Math.min(smallOrderFloor, 1000);
  if (qty <= 49) return Math.min(smallOrderFloor, 800);
  return Math.min(smallOrderFloor, 650);
}

export function estimatedPaymentFeeCents({
  amountCents,
  paymentTerms = "full",
  depositAmountCents = 0,
  settings,
}: {
  amountCents: number;
  paymentTerms?: "full" | "deposit";
  depositAmountCents?: number;
  settings?: BusinessSettingsRecord | null;
}) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  if (!amount) return 0;
  const rate = Math.max(0, Number(settings?.payment_fee_basis_points ?? 290)) / 10000;
  const validDeposit = paymentTerms === "deposit" && depositAmountCents > 0 && depositAmountCents < amount;
  const payments = validDeposit ? 2 : 1;
  return Math.ceil(amount * rate) + payments * Math.max(0, Number(settings?.payment_fee_fixed_cents ?? 30));
}

export function recommendedRevenueWithSafeguards({
  baseCostCents,
  quantity,
  targetMarginBasisPoints,
  minimumProfitPerItemCents = 0,
  settings,
  paymentCount = 1,
}: {
  baseCostCents: number;
  quantity: number;
  targetMarginBasisPoints: number;
  minimumProfitPerItemCents?: number;
  settings?: BusinessSettingsRecord | null;
  paymentCount?: number;
}) {
  const baseCost = Math.max(0, Math.round(Number(baseCostCents) || 0));
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const overheadRate = Math.max(0, Number(settings?.overhead_basis_points ?? 1000)) / 10000;
  const paymentRate = Math.max(0, Number(settings?.payment_fee_basis_points ?? 290)) / 10000;
  const fixedFees = Math.max(1, Math.floor(paymentCount || 1)) * Math.max(0, Number(settings?.payment_fee_fixed_cents ?? 30));
  const targetMargin = Math.max(0, Number(targetMarginBasisPoints || 0)) / 10000;
  const marginDenominator = Math.max(0.01, 1 - targetMargin - overheadRate - paymentRate);
  const contributionDenominator = Math.max(0.01, 1 - overheadRate - paymentRate);
  const marginPrice = Math.ceil((baseCost + fixedFees) / marginDenominator);
  const minimumProfitPrice = Math.ceil((baseCost + qty * Math.max(0, Math.round(minimumProfitPerItemCents || 0)) + fixedFees) / contributionDenominator);
  return Math.max(marginPrice, minimumProfitPrice);
}
