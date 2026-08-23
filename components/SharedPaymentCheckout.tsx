"use client";

import { useState } from "react";
import { money } from "@/lib/quote-types";

export function SharedPaymentCheckout({ shareToken, amountCents, initialEmail = "", amountIsEstimate = false }: { shareToken: string; amountCents: number; initialEmail?: string; amountIsEstimate?: boolean }) {
  const [payerName, setPayerName] = useState("");
  const [payerEmail, setPayerEmail] = useState(initialEmail);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function pay() {
    if (!payerName.trim()) return setError("Enter the name of the person making the payment.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail.trim())) return setError("Enter a valid payer email address.");
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/payments/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shareToken, payerName: payerName.trim(), payerEmail: payerEmail.trim() }) });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Could not open secure checkout.");
      window.location.href = result.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open secure checkout.");
      setWorking(false);
    }
  }

  return (
    <div className="sharedPaymentCheckout">
      <div className="sharedPayerGrid"><label className="field"><span>Your name</span><input value={payerName} onChange={(e) => setPayerName(e.target.value)} autoComplete="name" /></label><label className="field"><span>Your email</span><input value={payerEmail} onChange={(e) => setPayerEmail(e.target.value)} type="email" autoComplete="email" /></label></div>
      <button className="btn" type="button" disabled={working} onClick={pay}>{working ? "Checking final tax…" : `Pay securely · ${amountIsEstimate ? "about " : ""}${money(amountCents)}`}</button>
      <span className="sharedStripeNote">{amountIsEstimate ? "Final sales tax is checked before Stripe opens. Review the final total there before paying." : "Card checkout is handled securely by Stripe."}</span>
      {error ? <div className="formError">{error}</div> : null}
    </div>
  );
}
