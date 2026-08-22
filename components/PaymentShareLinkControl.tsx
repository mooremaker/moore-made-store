"use client";

import { useEffect, useMemo, useState } from "react";
import { money } from "@/lib/quote-types";

type LinkRow = {
  id: string;
  active: boolean;
  created_at: string;
  revoked_at: string | null;
  label: string | null;
  recipient_email: string | null;
  emailed_at: string | null;
  email_status: "sent" | "failed" | null;
};

export function PaymentShareLinkControl({
  requestId,
  quoteId,
  requestNumber,
  quoteStatus,
  amountDueCents,
  policyAccepted,
  customerEmail,
}: {
  requestId: string;
  quoteId: string;
  requestNumber: string;
  quoteStatus: string;
  amountDueCents: number;
  policyAccepted: boolean;
  customerEmail?: string | null;
}) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [freshUrl, setFreshUrl] = useState("");
  const [recipientEmails, setRecipientEmails] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch(`/api/admin/payment-links?quoteId=${encodeURIComponent(quoteId)}`);
    const result = await response.json().catch(() => ({}));
    if (response.ok) setLinks(result.links || []);
  }

  useEffect(() => { void load(); }, [quoteId]);

  const activeLinks = useMemo(() => links.filter((row) => row.active && !row.revoked_at), [links]);
  const canShare = quoteStatus === "approved" && amountDueCents > 0 && policyAccepted;

  async function create() {
    setWorking(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", requestId, quoteId, label: `${requestNumber} payment link` }),
      });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Could not create payment link.");
      setFreshUrl(result.url);
      setMessage("Secure payment link created. Copy it now; the full private token cannot be revealed again later.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create payment link."); }
    finally { setWorking(false); }
  }

  async function sendEmail() {
    if (!recipientEmails.trim()) return setError("Enter at least one email address.");
    setWorking(true); setError(""); setMessage(""); setFreshUrl("");
    try {
      const response = await fetch("/api/admin/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "email", requestId, quoteId, recipientEmails }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not send payment email.");
      const sent = Array.isArray(result.sent) ? result.sent : [];
      const failed = Array.isArray(result.failed) ? result.failed : [];
      setMessage(
        failed.length
          ? `Sent ${sent.length} secure payment email${sent.length === 1 ? "" : "s"}. ${failed.length} address${failed.length === 1 ? "" : "es"} could not be sent.`
          : `Secure payment email${sent.length === 1 ? "" : "s"} sent to ${sent.join(", ")}.`
      );
      setRecipientEmails("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send payment email."); }
    finally { setWorking(false); }
  }

  async function revoke(id: string) {
    setWorking(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", linkId: id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not revoke link.");
      setFreshUrl(""); setMessage("Payment link revoked."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not revoke link."); }
    finally { setWorking(false); }
  }

  async function revokeAll() {
    if (!activeLinks.length) return;
    setWorking(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke-all", quoteId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not revoke links.");
      setFreshUrl(""); setMessage("All active payment links for this quote were revoked."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not revoke links."); }
    finally { setWorking(false); }
  }

  async function copy() {
    if (!freshUrl) return;
    await navigator.clipboard.writeText(freshUrl);
    setMessage("Payment link copied.");
  }

  return (
    <div className="paymentShareControl">
      <div className="paymentShareHead">
        <div>
          <strong>Secure payment links</strong>
          <span>Email a private payment link to any payer, or generate one to copy yourself. The order stays under the original customer.</span>
        </div>
        <span>{money(amountDueCents)} due</span>
      </div>

      {!canShare ? (
        <div className="muted">
          {quoteStatus !== "approved"
            ? "Payment links are available after the customer approves the quote."
            : amountDueCents <= 0
              ? "This order is already paid in full."
              : "The customer must accept the custom-order final-sale terms before a third-party payment link is sent."}
        </div>
      ) : (
        <>
          <div className="paymentEmailPanel">
            <div className="paymentEmailPanelHead">
              <div><strong>Email a secure payment link</strong><span>Enter any payer email. You can send to more than one person by separating addresses with commas.</span></div>
              {customerEmail ? <button className="paymentEmailQuickFill" type="button" onClick={() => setRecipientEmails(customerEmail)}>Use customer email</button> : null}
            </div>
            <div className="paymentEmailRow">
              <input
                type="text"
                inputMode="email"
                value={recipientEmails}
                onChange={(event) => setRecipientEmails(event.target.value)}
                placeholder="payer@example.com, accounting@business.com"
                aria-label="Payment email recipients"
              />
              <button className="btn" type="button" disabled={working} onClick={sendEmail}>{working ? "Sending…" : "Send secure payment email"}</button>
            </div>
            <small>Each recipient gets a different private link. The email shows only the approved customer-facing order and amount due — never Moore Made's internal costs.</small>
          </div>

          {freshUrl ? (
            <div className="paymentShareFresh">
              <input readOnly value={freshUrl} aria-label="New payment link" />
              <button className="btn" type="button" onClick={copy}>Copy link</button>
            </div>
          ) : null}

          <div className="paymentShareManualRow">
            <button className="btn secondary" type="button" disabled={working} onClick={create}>{working ? "Working…" : "Generate copyable link"}</button>
            {activeLinks.length > 1 ? <button className="btn secondary" type="button" disabled={working} onClick={revokeAll}>Revoke all active links</button> : null}
          </div>

          {activeLinks.length ? (
            <div className="paymentShareList">
              <div className="paymentShareListTitle"><strong>Active links</strong><span>{activeLinks.length}</span></div>
              {activeLinks.map((row) => (
                <div className="paymentShareActive" key={row.id}>
                  <div className="paymentShareActiveText">
                    <strong>{row.recipient_email ? `Emailed to ${row.recipient_email}` : row.label || "Copyable payment link"}</strong>
                    <span>{row.emailed_at ? `Sent ${new Date(row.emailed_at).toLocaleString()}` : `Created ${new Date(row.created_at).toLocaleString()}`}</span>
                  </div>
                  <button className="btn secondary" type="button" disabled={working} onClick={() => revoke(row.id)}>Revoke</button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}

      {message ? <div className="formSuccess">{message}</div> : null}
      {error ? <div className="formError">{error}</div> : null}
    </div>
  );
}
