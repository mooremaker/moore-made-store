export type FinancialPaymentRow = {
  id: string;
  request_id: string;
  quote_id: string;
  payment_kind: "full" | "deposit" | "balance";
  amount_cents: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "refunded";
  payment_method: "stripe" | "cashapp" | "cash" | "check" | "other";
  manual_reference: string | null;
  paid_at: string | null;
  created_at: string;
  receipt_number: number | null;
  receipt_token: string | null;
};

export type BusinessExpenseCategory =
  | "materials"
  | "shipping"
  | "equipment"
  | "software"
  | "advertising"
  | "fees"
  | "office"
  | "travel"
  | "other";

export const EXPENSE_CATEGORY_LABELS: Record<BusinessExpenseCategory, string> = {
  materials: "Materials / blanks",
  shipping: "Shipping / postage",
  equipment: "Equipment",
  software: "Software / subscriptions",
  advertising: "Advertising / marketing",
  fees: "Processing / bank fees",
  office: "Office / supplies",
  travel: "Travel / mileage",
  other: "Other",
};

export const EXPENSE_RECEIPT_BUCKET = "business-expense-receipts";

export type BusinessExpenseReceipt = {
  id: string;
  expense_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  url?: string | null;
};

export type BusinessExpenseRow = {
  id: string;
  expense_date: string;
  vendor: string;
  category: BusinessExpenseCategory;
  description: string | null;
  amount_cents: number;
  payment_method: string | null;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
  receipts?: BusinessExpenseReceipt[];
};

export function receiptLabel(receiptNumber: number | null | undefined) {
  if (!receiptNumber) return "Receipt";
  return `MM-R-${String(receiptNumber).padStart(6, "0")}`;
}

export function paymentMethodLabel(method: FinancialPaymentRow["payment_method"] | string) {
  if (method === "stripe") return "Card / Stripe";
  if (method === "cashapp") return "Cash App";
  if (method === "cash") return "Cash";
  if (method === "check") return "Check";
  return "Other";
}

export type FinancialOrderSummary = {
  id: string;
  request_number: number;
  customer_name: string;
  product: string;
  amount_paid_cents: number;
  payment_status: "unpaid" | "deposit_paid" | "paid";
  status: "new" | "reviewing" | "quote_sent" | "approved" | "in_production" | "ready" | "shipped" | "completed" | "cancelled";
};

export type FundingPartyKind = "member" | "family" | "external";
export type FundingEntryType =
  | "owner_contribution"
  | "loan_received"
  | "loan_repayment"
  | "reimbursement_due"
  | "reimbursement_paid"
  | "equity_investment"
  | "needs_classification";

export const FUNDING_PARTY_KIND_LABELS: Record<FundingPartyKind, string> = {
  member: "Owner / member",
  family: "Family",
  external: "Other outside funder",
};

export const FUNDING_ENTRY_TYPE_LABELS: Record<FundingEntryType, string> = {
  owner_contribution: "Owner contribution",
  loan_received: "Loan to Moore Made",
  loan_repayment: "Loan repayment",
  reimbursement_due: "Personal expense owed back",
  reimbursement_paid: "Reimbursement paid",
  equity_investment: "Equity investment",
  needs_classification: "Needs classification",
};

export const FUNDING_DOCUMENT_BUCKET = "business-funding-documents";

export type BusinessFundingDocument = {
  id: string;
  funding_entry_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  url?: string | null;
};

export type BusinessFundingRow = {
  id: string;
  entry_date: string;
  party_name: string;
  party_kind: FundingPartyKind;
  entry_type: FundingEntryType;
  amount_cents: number;
  payment_method: string | null;
  reference: string | null;
  note: string | null;
  ownership_percent: number | null;
  recorded_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  documents?: BusinessFundingDocument[];
};
