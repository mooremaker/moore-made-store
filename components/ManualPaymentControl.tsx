"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
};

function dollars(cents: number) {
  return (Math.max(0, cents) / 100).toFixed(2);
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
}: Props) {
  const router = useRouter();
  const nextPayment = useMemo(
    () => nextPaymentAmount({ totalCents, terms: paymentTerms, depositAmountCents, amountPaidCents }),
    [totalCents, paymentTerms, depositAmountCents, amountPaidCents]
  );
  const [amount, setAmount] = useState(dollars(nextPayment.amountCents));
  const [method, setMethod] = useState<PaymentMethod>("cashapp");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [receiptToken, setReceiptToken] = useState("");
  const [error, setError] = useState("");

  const remainingCents = Math.max(0, totalCents - amountPaidCents);
  const approved = quoteStatus === "approved";

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

      {!approved ? (
        <div className="requestWarning">Manual payment recording unlocks after the customer approves the proof + quote.</div>
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
