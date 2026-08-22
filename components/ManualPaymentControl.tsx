"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { paymentMethodLabel, receiptLabel, type FinancialPaymentRow } from "@/lib/finance-types";
import { money } from "@/lib/quote-types";
import { nextPaymentAmount, paymentStatusLabel, type PaymentStatus, type PaymentTerms } from "@/lib/payment-types";

type PaymentMethod = "cashapp" | "cash" | "check" | "other";

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

function dollars(cents: number) {
  return (Math.max(0, cents) / 100).toFixed(2);
}

function paymentDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export function ManualPaymentControl({
  requestId,
  quoteId,
  requestNumber,
  quoteStatus,
  totalCents,
  paymentTerms,
  depositAmountCents,
  amountPaidCents,
  paymentStatus,
  policyAccepted,
  policyAcceptedAt,
  payments,
}: Props) {
  const router = useRouter();
  const nextPayment = useMemo(
    () => nextPaymentAmount({ totalCents, terms: paymentTerms, depositAmountCents, amountPaidCents }),
    [totalCents, paymentTerms, depositAmountCents, amountPaidCents]
  );
  const paymentHistory = useMemo(
    () => [...payments]
      .filter((payment) => payment.status === "paid" || payment.status === "voided")
      .sort((a, b) => new Date(b.paid_at || b.created_at).getTime() - new Date(a.paid_at || a.created_at).getTime()),
    [payments]
  );
  const [amount, setAmount] = useState(dollars(nextPayment.amountCents));
  const [method, setMethod] = useState<PaymentMethod>("cashapp");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [receiptToken, setReceiptToken] = useState("");
  const [error, setError] = useState("");
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidSaving, setVoidSaving] = useState(false);

  useEffect(() => {
    setAmount(dollars(nextPayment.amountCents));
  }, [nextPayment.amountCents]);

  const remainingCents = Math.max(0, totalCents - amountPaidCents);
  const approved = quoteStatus === "approved";

  async function voidPayment(paymentId: string) {
    if (voidReason.trim().length < 3) {
      setError("Add a short correction reason so the audit history stays clear.");
      return;
    }
    setVoidSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/payments/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, reason: voidReason.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not correct payment.");
      setMessage(result.message || "Payment corrected and balance reopened.");
      setVoidingId(null); setVoidReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not correct payment.");
    } finally {
      setVoidSaving(false);
    }
  }

  async function recordPayment() {
    setSaving(true);
    setMessage("");
    setReceiptToken("");
    setError("");
    try {
      const amountCents = Math.round(Number(amount) * 100);
      if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error("Enter the amount you actually received.");
      if (amountCents > remainingCents) throw new Error(`That is more than the remaining balance of ${money(remainingCents)}.`);

      const response = await fetch("/api/admin/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, quoteId, amountCents, paymentMethod: method, reference, note }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not record payment.");
      setMessage(result.message || "Payment recorded.");
      setReceiptToken(result.receiptToken || "");
      setReference("");
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record payment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="manualPaymentCard">
      <div className="manualPaymentHead">
        <div>
          <span className="eyebrow">Manual payment</span>
          <h5>Record verified payment</h5>
          <p>Only record a payment after you have personally confirmed the money was received in Cash App or another accepted payment method.</p>
        </div>
        <span className={`manualPaymentStatus payment-${paymentStatus}`}>{paymentStatusLabel(paymentStatus)}</span>
      </div>

      <div className="manualPaymentTotals">
        <div><span>Order total</span><strong>{money(totalCents)}</strong></div>
        <div><span>Recorded paid</span><strong>{money(amountPaidCents)}</strong></div>
        <div><span>Remaining</span><strong>{money(remainingCents)}</strong></div>
      </div>

      {paymentHistory.length ? (
        <section className="manualPaymentHistory" aria-label={`Payment receipts for ${requestNumber}`}>
          <div className="manualPaymentHistoryHead">
            <div><span className="eyebrow">Receipts</span><strong>Payment history</strong></div>
            <small>{paymentHistory.length} record{paymentHistory.length === 1 ? "" : "s"}</small>
          </div>
          <div className="manualPaymentHistoryList">
            {paymentHistory.map((payment) => (
              <div className={`manualPaymentHistoryRow ${payment.status === "voided" ? "isVoided" : ""}`} key={payment.id}>
                <div className="paymentHistoryIdentity">
                  <strong>{receiptLabel(payment.receipt_number)}{payment.status === "voided" ? " · VOIDED" : ""}</strong>
                  <small>{paymentDate(payment.paid_at || payment.created_at)} · {paymentMethodLabel(payment.payment_method)}{payment.payer_name ? ` · Paid by ${payment.payer_name}` : ""}</small>
                  {payment.status === "voided" && payment.void_reason ? <small className="voidReasonText">Correction: {payment.void_reason}</small> : null}
                </div>
                <strong>{money(payment.amount_cents)}</strong>
                <div className="paymentHistoryActions">
                  {payment.receipt_token ? <a className="btn secondary" href={`/receipt/${payment.receipt_token}`} target="_blank" rel="noreferrer">View receipt ↗</a> : <span className="manualPaymentReceiptMissing">Receipt unavailable</span>}
                  {payment.status === "paid" && payment.payment_method !== "stripe" ? <button className="textButton dangerText" type="button" onClick={() => { setVoidingId(payment.id); setVoidReason(""); setError(""); }}>Correct / void</button> : null}
                  {payment.status === "paid" && payment.payment_method === "stripe" ? <small className="stripeCorrectionNote">Stripe charges must be refunded/corrected in Stripe.</small> : null}
                </div>
                {voidingId === payment.id ? <div className="paymentVoidEditor">
                  <label className="field"><span>Why is this payment being corrected?</span><input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={1000} placeholder="Example: Cash was marked received, but customer changed to card before cash was handed over." /></label>
                  <div><button className="btn secondary" type="button" disabled={voidSaving} onClick={() => setVoidingId(null)}>Cancel</button><button className="btn" type="button" disabled={voidSaving} onClick={() => voidPayment(payment.id)}>{voidSaving ? "Correcting…" : "Void record & reopen balance"}</button></div>
                </div> : null}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="manualPaymentNoReceipts"><strong>No receipts yet.</strong><span>The first receipt will appear here after a payment is recorded.</span></div>
      )}

      {policyAccepted ? <p className="manualPaymentPolicyAccepted">Final-sale terms accepted ✓{policyAcceptedAt ? ` · ${new Date(policyAcceptedAt).toLocaleString("en-US", { timeZone: "America/New_York" })}` : ""}</p> : null}

      {!approved ? (
        <div className="requestWarning">Manual payment recording unlocks after the customer approves the proof + quote.</div>
      ) : !policyAccepted ? (
        <div className="requestWarning"><strong>Final-sale terms still need customer acceptance.</strong><br />Have the customer open their approved proof + quote payment page and accept the required custom-order terms before you record any payment.</div>
      ) : remainingCents <= 0 ? (
        <div className="quoteResponseSuccess"><strong>Paid in full ✓</strong><p>No balance remains on {requestNumber}.</p></div>
      ) : (
        <>
          <div className="manualPaymentGrid manualPaymentPrimaryGrid">
            <label className="field manualPaymentField">
              <span>Amount received</span>
              <div className="moneyInput"><span>$</span><input type="number" min="0.01" step="0.01" max={dollars(remainingCents)} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            </label>
            <label className="field manualPaymentField">
              <span>Payment method</span>
              <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                <option value="cashapp">Cash App</option>
                <option value="cash">Cash — by arrangement</option>
                <option value="check">Check</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <p className="manualPaymentExpected">Expected payment right now: <strong>{money(nextPayment.amountCents)}</strong>. Change the amount only if you actually received a different amount.</p>

          <div className="manualPaymentGrid">
            <label className="field">
              <span>Reference / transaction note</span>
              <input maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional Cash App transaction ID or note" />
            </label>
            <label className="field">
              <span>Internal note</span>
              <input maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </label>
          </div>

          {error ? <div className="formError">{error}</div> : null}
          {message ? <div className="formSuccess manualPaymentSuccess">{message}{receiptToken ? <a className="btn secondary" href={`/receipt/${receiptToken}`} target="_blank" rel="noreferrer">Open receipt ↗</a> : null}</div> : null}
          <button className="btn" type="button" disabled={saving} onClick={recordPayment}>
            {saving ? "Recording…" : `Record ${money(Math.round(Number(amount || 0) * 100))} payment`}
          </button>
        </>
      )}
    </div>
  );
}
