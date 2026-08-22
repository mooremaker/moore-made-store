export type ProductPricingRecord = {
  product_slug: string;
  product_name: string;
  active: boolean;
  blank_cost_cents: number;
  print_cost_cents: number;
  packaging_cost_cents: number;
  default_labor_hours: number;
  labor_rate_cents: number;
  target_margin_basis_points: number;
  tax_code: string;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

export type BusinessSettingsRecord = {
  id: string;
  default_labor_rate_cents: number;
  minimum_labor_hours: number;
  pickup_address: Record<string, string> | null;
  default_tax_code: string;
  shipping_tax_code: string;
  updated_at?: string;
};

export function recommendedRevenueForMargin(costCents: number, marginBasisPoints: number) {
  const cost = Math.max(0, Math.round(costCents || 0));
  const margin = Math.min(9500, Math.max(0, Math.round(marginBasisPoints || 0))) / 10000;
  if (cost <= 0) return 0;
  if (margin >= 1) return cost;
  return Math.ceil(cost / (1 - margin));
}
