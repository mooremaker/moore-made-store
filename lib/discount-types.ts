export type DiscountKind = "percent" | "fixed";

export type DiscountRedemption = {
  id: string;
  quote_id: string;
  request_id: string;
  customer_email: string;
  discount_cents: number;
  redeemed_at: string;
};

export type DiscountCodeRecord = {
  id: string;
  code: string;
  description: string | null;
  kind: DiscountKind;
  percent_off: number | null;
  amount_off_cents: number | null;
  min_order_cents: number;
  max_uses: number | null;
  per_customer_limit: number | null;
  starts_at: string | null;
  expires_at: string | null;
  active: boolean;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
  discount_redemptions?: DiscountRedemption[];
};

export function normalizeDiscountCode(value: string) {
  return value.trim().toUpperCase();
}

export function discountAmountCents(code: DiscountCodeRecord | null | undefined, eligibleCents: number) {
  if (!code || eligibleCents <= 0) return 0;
  if (code.kind === "percent") {
    return Math.min(eligibleCents, Math.round(eligibleCents * (Number(code.percent_off || 0) / 100)));
  }
  return Math.min(eligibleCents, Math.max(0, Number(code.amount_off_cents || 0)));
}

export function discountCodeLabel(code: DiscountCodeRecord) {
  return code.kind === "percent"
    ? `${Number(code.percent_off || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}% off`
    : `${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(code.amount_off_cents || 0) / 100)} off`;
}
