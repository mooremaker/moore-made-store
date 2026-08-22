"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { paymentMethodLabel, receiptLabel, type FinancialPaymentRow } from "@/lib/finance-types";
import { money } from "@/lib/quote-types";
import { paymentStatusLabel, type PaymentStatus, type PaymentTerms } from "@/lib/payment-types";

type Props = {
  requestId: string;
  quoteId: string;
  requestNumber: string;
  quoteStatus: string;
  totalCents: number;
  paymentTerms: PaymentTerms;
  depositAmountCents: number | null;
  amountPaidCents: number;
  paymentStatus: PaymentStatus;
  policyAccepted: boolean;
  policyAcceptedAt: string | null;
  payments: FinancialPaymentRow[];
};

function paymentDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export function ManualPaymentControl({ requestNumber, totalCents, amountPaidCents, paymentStatus, payments }: Props) {
  const router = useRouter();
  const history = useMemo(() => [...payments]
    .filter((payment) => payment.status === "paid" || payment.status === "voided")
    .sort((a, b) => new Date(b.paid_at || b.created_at).getTime() - new Date(a.paid_at || a.created_at).getTime()), [payments]);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function voidHistoricalPayment(paymentId: string) {
    if (voidReason.trim().length < 3) { setError("Add a short correction reason."); return; }
    setSaving(true); setError("");
    const response = await fetch("/api/admin/payments/void", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId, reason: voidReason.trim() }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) { setError(data.error || "Could not correct the historical payment."); return; }
    setVoidingId(null); setVoidReason(""); router.refresh();
  }

  return <div className="manualPaymentCard">
    <div className="manualPaymentHead"><div><span className="eyebrow">Stripe only</span><h5>Payment records</h5><p>New payments are accepted through Stripe Checkout and recorded automatically. Cash, checks, Cash App, and manual payment entry are disabled.</p></div><span className={`manualPaymentStatus payment-${paymentStatus}`}>{paymentStatusLabel(paymentStatus)}</span></div>
    <div className="manualPaymentTotals"><div><span>Order total</span><strong>{money(totalCents)}</strong></div><div><span>Recorded paid</span><strong>{money(amountPaidCents)}</strong></div><div><span>Remaining</span><strong>{money(Math.max(0, totalCents - amountPaidCents))}</strong></div></div>
    {history.length ? <section className="manualPaymentHistory" aria-label={`Payment records for ${requestNumber}`}><div className="manualPaymentHistoryHead"><div><span className="eyebrow">History</span><strong>Preserved payment records</strong></div><small>{history.length} record{history.length === 1 ? "" : "s"}</small></div><div className="manualPaymentHistoryList">{history.map((payment) => <div className={`manualPaymentHistoryRow ${payment.status === "voided" ? "isVoided" : ""}`} key={payment.id}>
      <div className="paymentHistoryIdentity"><strong>{receiptLabel(payment.receipt_number)}{payment.status === "voided" ? " · VOIDED" : ""}</strong><small>{paymentDate(payment.paid_at || payment.created_at)} · {paymentMethodLabel(payment.payment_method)}</small>{payment.void_reason ? <small className="voidReasonText">Correction: {payment.void_reason}</small> : null}</div>
      <strong>{money(payment.amount_cents)}</strong>
      <div className="paymentHistoryActions">{payment.receipt_token ? <a className="btn secondary" href={`/receipt/${payment.receipt_token}`} target="_blank" rel="noreferrer">View receipt ↗</a> : null}{payment.status === "paid" && payment.payment_method !== "stripe" ? <button className="textButton dangerText" type="button" onClick={() => setVoidingId(payment.id)}>Correct old record</button> : null}{payment.status === "paid" && payment.payment_method === "stripe" ? <small className="stripeCorrectionNote">Refund or correct this charge in Stripe.</small> : null}</div>
      {voidingId === payment.id ? <div className="paymentVoidEditor"><label className="field"><span>Correction reason</span><input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} maxLength={1000} /></label><div><button className="btn secondary" type="button" onClick={() => setVoidingId(null)}>Cancel</button><button className="btn" type="button" disabled={saving} onClick={() => void voidHistoricalPayment(payment.id)}>{saving ? "Correcting…" : "Void old record"}</button></div></div> : null}
    </div>)}</div></section> : <div className="manualPaymentNoReceipts"><strong>No payment received yet.</strong><span>The Stripe receipt will appear here automatically after checkout.</span></div>}
    {error ? <div className="formError">{error}</div> : null}
  </div>;
}
