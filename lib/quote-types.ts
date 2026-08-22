export const QUOTE_STATUSES = ["draft", "sent", "approved", "declined", "changes_requested", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent for approval",
  approved: "Approved",
  declined: "Declined",
  changes_requested: "Changes requested",
  expired: "Expired",
};

export type QuoteLineItem = {
  description: string;
  quantity: number;
  unitPriceCents: number;
};

export type QuoteProofAsset = {
  id?: string;
  path: string;
  originalName?: string | null;
  sortOrder?: number;
  url?: string;
};

export type QuoteProofItem = {
  id: string;
  quoteId?: string;
  proofVersion: number;
  title: string;
  notes: string | null;
  sortOrder: number;
  assets: QuoteProofAsset[];
};

export type QuoteChangeItem = {
  proofItemId: string | null;
  proofItemTitle: string;
  message: string;
};

export type QuoteChangeRequest = {
  id: string;
  proofVersion: number;
  generalMessage: string | null;
  createdAt: string;
  items: QuoteChangeItem[];
};

export type QuoteRevision = {
  id: string;
  revision_number: number;
  status: QuoteStatus;
  revision_reason: string | null;
  total_cents: number;
  estimated_profit_cents: number;
  estimated_margin_basis_points: number;
  proof_version: number;
  sent_at: string | null;
  responded_at: string | null;
  created_at: string;
  mockup_snapshot?: unknown | null;
};

export type QuoteRecord = {
  id: string;
  request_id: string;
  public_token: string;
  status: QuoteStatus;
  line_items: QuoteLineItem[];
  setup_fee_cents: number;
  shipping_cents: number;
  tax_cents: number;
  tax_mode?: "automatic" | "manual" | "exempt";
  stripe_tax_calculation_id?: string | null;
  tax_calculated_at?: string | null;
  tax_exempt_reason?: string | null;
  tax_breakdown?: Record<string, unknown> | null;
  tax_input_fingerprint?: string | null;
  discount_cents: number;
  manual_discount_cents?: number;
  promo_discount_cents?: number;
  discount_code_id?: string | null;
  applied_discount_code?: string | null;
  subtotal_cents: number;
  total_cents: number;
  payment_terms: "full" | "deposit";
  deposit_amount_cents: number | null;
  internal_supply_cost_cents?: number;
  internal_print_cost_cents?: number;
  internal_packaging_cost_cents?: number;
  internal_shipping_cost_cents?: number;
  internal_payment_fee_cents?: number;
  internal_other_cost_cents?: number;
  labor_hours?: number;
  labor_rate_cents?: number;
  labor_cost_cents?: number;
  internal_total_cost_cents?: number;
  estimated_profit_cents?: number;
  estimated_margin_basis_points?: number;
  revision_number?: number;
  revision_reason?: string | null;
  notes: string | null;
  valid_until: string | null;
  proof_paths?: string[];
  proof_notes?: string | null;
  proof_version: number;
  customer_change_request: string | null;
  mockup_snapshot?: unknown | null;
  sent_at: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
  proofItems?: QuoteProofItem[];
  proofItemsVersion?: number;
  changeRequests?: QuoteChangeRequest[];
  paymentPolicyAccepted?: boolean;
  paymentPolicyAcceptedAt?: string | null;
  revisions?: QuoteRevision[];
};

export function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}
