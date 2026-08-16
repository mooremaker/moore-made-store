"use client";

import { useState } from "react";
import { money } from "@/lib/quote-types";

type CashRequestStatus = "none" | "pending" | "contacted" | "completed" | "cancelled";

type Props = {
  token: string;
  amountCents: number;
  initialStatus: CashRequestStatus;
};

export function CashPaymentRequestButton({ token, amountCents, initialStatus }: Props) {
  const [status, setStatus] = useState<CashRequestStatus>(initialStatus);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function requestCash() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/quotes/${token}/cash-request`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not send the cash payment request.");
      setStatus("pending");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the cash payment request.");
    } finally {
      setWorking(false);
    }
  }

  if (status === "pending" || status === "contacted") {
    return (
      <div className="cashArrangementConfirmed">
        <strong>{status === "contacted" ? "Cash payment is being arranged" : "Cash payment request sent ✓"}</strong>
        <p>Moore Made will contact you to arrange the payment. Your order remains unpaid until the cash is received and confirmed.</p>
      </div>
    );
  }

  if (status === "completed") return null;

  return (
    <div className="cashArrangementPanel">
      <div>
        <span className="eyebrow">Need another option?</span>
        <h3>Request to pay cash</h3>
        <p>Cash is available by prior arrangement only. Send a request and Moore Made will contact you to coordinate payment of <strong>{money(amountCents)}</strong>.</p>
      </div>
      <button className="btn secondary cashArrangementButton" type="button" disabled={working} onClick={requestCash}>
        {working ? "Sending request…" : "Request cash payment"}
      </button>
      {error ? <div className="formError">{error}</div> : null}
    </div>
  );
}
