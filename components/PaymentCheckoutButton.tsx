"use client";

import { useState } from "react";
import { money } from "@/lib/quote-types";

export function PaymentCheckoutButton({
  token,
  amountCents,
  label,
  amountIsEstimate = false,
}: {
  token: string;
  amountCents: number;
  label: string;
  amountIsEstimate?: boolean;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function checkout() {
    setError("");
    setWorking(true);
    try {
      const response = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Could not open secure checkout.");
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open secure checkout.");
      setWorking(false);
    }
  }

  return (
    <div className="paymentCheckoutAction">
      <button className="btn paymentCheckoutButton" type="button" onClick={checkout} disabled={working || amountCents <= 0}>
        {working ? "Checking final tax and opening checkout…" : `${label} · ${amountIsEstimate ? "about " : ""}${money(amountCents)}`}
      </button>
      <span>{amountIsEstimate ? "Final sales tax is checked before Stripe opens. Review the final total there before paying." : "Secure checkout is handled by Stripe. Moore Made never receives your full card number."}</span>
      {error ? <div className="formError">{error}</div> : null}
    </div>
  );
}
