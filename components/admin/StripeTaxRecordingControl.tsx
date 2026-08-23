"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { money, type QuoteRecord } from "@/lib/quote-types";

type Props = {
  quote: QuoteRecord;
  amountPaidCents: number;
};

export function StripeTaxRecordingControl({ quote, amountPaidCents }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  if (quote.tax_mode !== "automatic" || Number(quote.tax_cents || 0) <= 0) return null;

  const paidInFull = amountPaidCents >= Number(quote.total_cents || 0);
  const recorded = Boolean(quote.stripe_tax_transaction_id);

  async function repair() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/tax/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: quote.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not record tax in Stripe.");
      setMessage("Tax is now recorded in Stripe Tax. No additional customer charge was created.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not record tax in Stripe.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={recorded ? "quoteLocked" : "requestWarning"}>
      <strong>{recorded ? "Sales tax recorded in Stripe Tax" : paidInFull ? "Sales tax collected—Stripe Tax record needs attention" : "Sales tax ready for Stripe Tax"}</strong>
      <span>
        {recorded
          ? `${money(quote.tax_cents)} in sales tax is linked to Stripe Tax transaction ${quote.stripe_tax_transaction_id}. This is separate from Stripe's processing fee.`
          : paidInFull
            ? `${money(quote.tax_cents)} was included in the customer's paid total, but the Stripe Tax reporting transaction is missing.`
            : `${money(quote.tax_cents)} will be recorded in Stripe Tax automatically after the order is paid in full.`}
      </span>
      {!recorded && paidInFull ? <button className="btn secondary" type="button" onClick={repair} disabled={saving}>{saving ? "Recording…" : "Repair Stripe Tax record"}</button> : null}
      {message ? <small>{message}</small> : null}
    </div>
  );
}
