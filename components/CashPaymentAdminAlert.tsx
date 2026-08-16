"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/quote-types";

type CashRequestStatus = "none" | "pending" | "contacted" | "completed" | "cancelled";

type Props = {
  requestId: string;
  requestNumber: string;
  customerName: string;
  email: string;
  phone: string | null;
  smsConsent: boolean;
  amountCents: number | null;
  initialStatus: CashRequestStatus;
  requestedAt: string | null;
};

export function CashPaymentAdminAlert({ requestId, requestNumber, customerName, email, phone, smsConsent, amountCents, initialStatus, requestedAt }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function updateStatus(nextStatus: "contacted" | "cancelled") {
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/admin/payments/cash-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, status: nextStatus }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update the cash request.");
      setStatus(nextStatus);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the cash request.");
    } finally {
      setWorking(false);
    }
  }

  if (status === "none" || status === "completed" || status === "cancelled") return null;

  const textBody = `Hi ${customerName}, this is Moore Made regarding ${requestNumber}. I saw your request to arrange cash payment${amountCents ? ` of ${money(amountCents)}` : ""}. Let me know what works best for coordinating payment.`;
  const smsHref = phone ? `sms:${phone}?body=${encodeURIComponent(textBody)}` : "#";
  const mailSubject = encodeURIComponent(`Cash payment arrangement — ${requestNumber}`);
  const mailBody = encodeURIComponent(`Hi ${customerName},\n\nI saw your request to arrange cash payment for ${requestNumber}${amountCents ? ` (${money(amountCents)})` : ""}. Please reply so we can coordinate the payment.\n\nMoore Made`);

  return (
    <div className={`cashAdminAlert ${status === "contacted" ? "cashAdminContacted" : ""}`}>
      <div className="cashAdminAlertHead">
        <div>
          <span className="eyebrow">Cash payment request</span>
          <h5>{status === "contacted" ? "Customer contacted" : "Customer is waiting for payment arrangements"}</h5>
          <p>{amountCents ? `${money(amountCents)} requested` : "Cash payment requested"}{requestedAt ? ` · ${new Date(requestedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}</p>
        </div>
        <span className="cashRequestBadge">{status === "contacted" ? "Contacted" : "Needs contact"}</span>
      </div>

      <div className="cashAdminContactActions">
        {phone && smsConsent ? <a className="btn" href={smsHref}>Text customer</a> : null}
        <a className="btn secondary" href={`mailto:${email}?subject=${mailSubject}&body=${mailBody}`}>Email customer</a>
        {phone && !smsConsent ? <span className="cashContactNote">No text permission — use email or call only if appropriate.</span> : null}
      </div>

      <div className="cashAdminManagement">
        {status === "pending" ? <button className="btn secondary" type="button" disabled={working} onClick={() => updateStatus("contacted")}>{working ? "Saving…" : "Mark contacted"}</button> : null}
        <button className="cashDismissButton" type="button" disabled={working} onClick={() => updateStatus("cancelled")}>Dismiss cash request</button>
      </div>
      {error ? <div className="formError">{error}</div> : null}
    </div>
  );
}
