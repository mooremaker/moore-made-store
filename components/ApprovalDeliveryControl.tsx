"use client";

import { useEffect, useState } from "react";

type Props = {
  requestId: string;
  customerEmail?: string | null;
};

export function ApprovalDeliveryControl({ requestId, customerEmail }: Props) {
  const [recipientEmails, setRecipientEmails] = useState(customerEmail || "");
  const [approvalUrl, setApprovalUrl] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const response = await fetch(`/api/admin/notifications?requestId=${encodeURIComponent(requestId)}`);
      const result = await response.json().catch(() => ({}));
      if (response.ok) setApprovalUrl(result.approvalUrl || "");
    } catch {
      // The resend button can still try even if this lookup fails.
    }
  }

  useEffect(() => { void load(); }, [requestId]);

  async function send() {
    if (!recipientEmails.trim()) return setError("Enter an email address first.");
    setWorking(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, type: "quote_approval", recipientEmails }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not resend the approval email.");
      const sent = Array.isArray(result.sent) ? result.sent : [];
      const failed = Array.isArray(result.failed) ? result.failed : [];
      if (result.approvalUrl) setApprovalUrl(result.approvalUrl);
      setMessage(failed.length ? `Sent to ${sent.join(", ")}. ${failed.length} address${failed.length === 1 ? "" : "es"} failed.` : `Approval email sent to ${sent.join(", ")}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the approval email.");
    } finally {
      setWorking(false);
    }
  }

  async function copy() {
    if (!approvalUrl) {
      await load();
      setError("The approval link is still loading. Try Copy approval link again in a moment.");
      return;
    }
    try {
      await navigator.clipboard.writeText(approvalUrl);
      setMessage("Approval link copied. It points to the live Moore Made site, not localhost.");
      setError("");
    } catch {
      setError("Your browser blocked automatic copying. Use Open approval page and copy the address from the browser.");
    }
  }

  return (
    <div className="approvalDeliveryControl">
      <div className="approvalDeliveryHead">
        <div>
          <strong>Waiting for customer approval</strong>
          <span>The quote stays locked so the version cannot change while they review it. You can resend access as many times as needed.</span>
        </div>
        <span className="approvalDeliveryBadge">Safe to resend</span>
      </div>

      <div className="approvalDeliveryReminder">
        <strong>No need to make a new quote.</strong>
        <span>Resending uses the exact same current proof + quote and does not change their approval version.</span>
      </div>

      <div className="approvalDeliveryEmailRow">
        <input
          type="text"
          inputMode="email"
          value={recipientEmails}
          onChange={(event) => setRecipientEmails(event.target.value)}
          placeholder="customer@example.com"
          aria-label="Approval email recipient"
        />
        <button className="btn" type="button" disabled={working} onClick={send}>{working ? "Sending…" : "Resend approval email"}</button>
      </div>
      <small>Need to send it to a spouse, office manager, or another helper? You can type a different email or multiple emails separated by commas.</small>

      <div className="approvalDeliveryActions">
        <button className="btn secondary" type="button" onClick={copy}>Copy approval link</button>
        {approvalUrl ? <a className="btn secondary" href={approvalUrl} target="_blank" rel="noreferrer">Open approval page ↗</a> : null}
      </div>

      {message ? <div className="formSuccess">{message}</div> : null}
      {error ? <div className="formError">{error}</div> : null}
    </div>
  );
}
