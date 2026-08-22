export const PAYMENT_TERMS = ["full", "deposit"] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

export const PAYMENT_STATUSES = ["unpaid", "deposit_paid", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type PaymentRow = {
  id: string;
  request_id: string;
  quote_id: string;
  payment_kind: "full" | "deposit" | "balance";
  amount_cents: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "refunded" | "voided";
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
  created_at: string;
};

export function paymentTermsLabel(terms: PaymentTerms) {
  return terms === "deposit" ? "Custom deposit" : "Full payment";
}

export function paymentStatusLabel(status: PaymentStatus) {
  if (status === "paid") return "Paid in full";
  if (status === "deposit_paid") return "Deposit paid";
  return "Payment due";
}

export function quoteRequiredDeposit(totalCents: number, terms: PaymentTerms, depositAmountCents: number | null | undefined) {
  if (terms !== "deposit") return Math.max(0, totalCents);
  return Math.min(Math.max(0, Number(depositAmountCents || 0)), Math.max(0, totalCents));
}

export function nextPaymentAmount({
  totalCents,
  terms,
  depositAmountCents,
  amountPaidCents,
}: {
  totalCents: number;
  terms: PaymentTerms;
  depositAmountCents?: number | null;
  amountPaidCents: number;
}) {
  const total = Math.max(0, totalCents || 0);
  const paid = Math.min(total, Math.max(0, amountPaidCents || 0));
  if (paid >= total) return { amountCents: 0, kind: null as null | "full" | "deposit" | "balance", remainingCents: 0 };

  if (terms === "deposit") {
    const requiredDeposit = quoteRequiredDeposit(total, terms, depositAmountCents);
    if (paid < requiredDeposit) {
      return { amountCents: requiredDeposit - paid, kind: "deposit" as const, remainingCents: total - paid };
    }
    return { amountCents: total - paid, kind: "balance" as const, remainingCents: total - paid };
  }

  return { amountCents: total - paid, kind: "full" as const, remainingCents: total - paid };
}
