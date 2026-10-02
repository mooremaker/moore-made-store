"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function CancelOrderControl({ requestId, direct }: { requestId: string; direct: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState("");
  async function submit() {
    if (working || outcome) return;
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/account/cancellation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, reason, confirmed }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not record cancellation.");
      setOutcome(result.outcome); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setWorking(false); }
  }
  if (outcome) return <p role="status">{outcome === "cancelled" ? "Your request has been cancelled." : "Your cancellation request was sent to Moore Made for review. Your order remains active until Moore Made confirms cancellation. No refund has been issued."}</p>;
  return <div>
    <button className="btn secondary" type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}>{direct ? "Cancel request" : "Request cancellation"}</button>
    {open ? <div className="orderNotificationBody">
      <p>{direct ? "An unpaid, unapproved request can be cancelled. If approval or payment has since started, we will send your request to Moore Made for review instead." : "Moore Made will review this request. Submitting it does not cancel production or issue a refund. Existing payment terms continue to apply."}</p>
      <label className="field"><span>Reason for cancellation</span><textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} disabled={working} /></label>
      <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={working} /> I understand and want to submit this cancellation.</label>
      <button className="btn" type="button" disabled={working || !confirmed || reason.trim().length < 3} onClick={() => void submit()}>{working ? "Submitting…" : "Confirm cancellation request"}</button>
      {error ? <p className="formError" role="alert">{error}</p> : null}
    </div> : null}
  </div>;
}
