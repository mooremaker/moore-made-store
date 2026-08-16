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

export type QuoteRecord = {
  id: string;
  request_id: string;
  public_token: string;
  status: QuoteStatus;
  line_items: QuoteLineItem[];
  setup_fee_cents: number;
  shipping_cents: number;
  tax_cents: number;
  discount_cents: number;
  subtotal_cents: number;
  total_cents: number;
  payment_terms: "full" | "deposit";
  deposit_amount_cents: number | null;
  notes: string | null;
  valid_until: string | null;
  proof_paths?: string[];
  proof_notes?: string | null;
  proof_version: number;
  customer_change_request: string | null;
  sent_at: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
  proofItems?: QuoteProofItem[];
  proofItemsVersion?: number;
  changeRequests?: QuoteChangeRequest[];
};

export function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}
