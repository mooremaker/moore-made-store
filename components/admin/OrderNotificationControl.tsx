"use client";

import { useEffect, useMemo, useState } from "react";

type NotificationType = "order_received" | "payment_receipt" | "production_update" | "ready" | "shipped" | "general";
type LogRow = {
  id: string;
  notification_type: string;
  recipient_email: string;
  subject: string;
  status: "sent" | "failed";
  error_message: string | null;
  sent_at: string;
};

type Props = {
  requestId: string;
  requestNumber: string;
  customerEmail: string;
  orderStatus: string;
  paymentStatus: string;
  delivery: string | null;
};

const LABELS: Record<NotificationType, string> = {
  order_received: "Order received confirmation",
  payment_receipt: "Payment receipt / confirmation",
  production_update: "Production update",
  ready: "Ready for pickup",
  shipped: "Shipped notification",
  general: "General order update",
};

function localDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export function OrderNotificationControl({ requestId, requestNumber, customerEmail, orderStatus, paymentStatus, delivery }: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<NotificationType>("order_received");
  const [recipientEmails, setRecipientEmails] = useState(customerEmail);
  const [customSubject, setCustomSubject] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [logReady, setLogReady] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const fulfillmentValue = String(delivery || "").toLowerCase();
  const isShipping = fulfillmentValue.includes("ship");
  const isLocalDelivery = fulfillmentValue.includes("delivery") && !isShipping;
  const labels = useMemo<Record<NotificationType, string>>(() => ({
    ...LABELS,
    ready: isLocalDelivery ? "Ready for delivery" : "Ready for pickup",
  }), [isLocalDelivery]);

  const available = useMemo(() => {
    const rows: NotificationType[] = ["order_received"];
    if (paymentStatus !== "unpaid") rows.push("payment_receipt");
    if (["in_production", "ready", "shipped", "completed"].includes(orderStatus)) rows.push("production_update");
    if (orderStatus === "ready" || (orderStatus === "completed" && !isShipping)) rows.push("ready");
    if (orderStatus === "shipped" || (orderStatus === "completed" && isShipping)) rows.push("shipped");
    rows.push("general");
    return rows;
  }, [orderStatus, paymentStatus, isShipping]);

  async function load() {
    try {
      const response = await fetch(`/api/admin/notifications?requestId=${encodeURIComponent(requestId)}`);
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        setLogs(Array.isArray(result.logs) ? result.logs : []);
        setLogReady(result.logReady !== false);
      }
    } catch {
      // Keep the send controls usable even if history is unavailable.
    }
  }

  useEffect(() => { void load(); }, [requestId]);
  useEffect(() => { if (!available.includes(type)) setType(available[0]); }, [available, type]);

  async function send() {
    if (!recipientEmails.trim()) return setError("Enter at least one email address.");
    setWorking(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, type, recipientEmails, customSubject, customMessage }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not send this notification.");
      const sent = Array.isArray(result.sent) ? result.sent : [];
      const failed = Array.isArray(result.failed) ? result.failed : [];
      setMessage(failed.length ? `Sent to ${sent.join(", ")}. ${failed.length} address${failed.length === 1 ? "" : "es"} failed.` : `Email sent to ${sent.join(", ")}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send this notification.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="orderNotificationControl">
      <button className="orderNotificationToggle" type="button" onClick={() => setOpen((value) => !value)}>
        <span><strong>Notifications & resend center</strong><small>Resend customer emails without changing the order or its status.</small></span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open ? <div className="orderNotificationBody">
        <div className="orderNotificationNotice"><strong>Grandma-friendly rule:</strong><span>Emails contain clear buttons and customer links always point to the live Moore Made website — never your localhost computer.</span></div>
        <div className="twoCol">
          <label className="field"><span>Email type</span><select value={type} onChange={(event) => setType(event.target.value as NotificationType)}>{available.map((value) => <option value={value} key={value}>{labels[value]}</option>)}</select></label>
          <label className="field"><span>Send to</span><input type="text" inputMode="email" value={recipientEmails} onChange={(event) => setRecipientEmails(event.target.value)} placeholder="customer@example.com" /><small>Comma-separated emails are okay.</small></label>
        </div>
        {type === "general" ? <div className="orderNotificationCustom">
          <label className="field"><span>Email subject</span><input value={customSubject} maxLength={180} onChange={(event) => setCustomSubject(event.target.value)} placeholder="Quick update on your order" /></label>
          <label className="field"><span>Message</span><textarea value={customMessage} maxLength={4000} onChange={(event) => setCustomMessage(event.target.value)} placeholder="Write the customer-friendly update here…" /></label>
        </div> : <div className="fieldHelp">This uses the order's current saved information. It sends an email only — it does not move the order backward, create a new quote, or duplicate a payment.</div>}
        <button className="btn" type="button" disabled={working} onClick={send}>{working ? "Sending…" : `Send ${labels[type].toLowerCase()}`}</button>
        {message ? <div className="formSuccess">{message}</div> : null}
        {error ? <div className="formError">{error}</div> : null}

        <div className="notificationHistory">
          <div className="notificationHistoryHead"><strong>Recent email history</strong><span>{requestNumber}</span></div>
          {!logReady ? <div className="requestWarning">Run the Phase 6.29 Supabase migration to save resend history. Sending still works.</div> : null}
          {logs.length ? logs.slice(0, 12).map((row) => <div className="notificationHistoryRow" key={row.id}>
            <div><strong>{row.subject}</strong><span>{row.recipient_email} · {localDateTime(row.sent_at)}</span>{row.status === "failed" && row.error_message ? <small>{row.error_message}</small> : null}</div>
            <span className={row.status === "sent" ? "notificationSent" : "notificationFailed"}>{row.status === "sent" ? "Sent" : "Failed"}</span>
          </div>) : <p className="muted">No notification resend history yet.</p>}
        </div>
      </div> : null}
    </div>
  );
}
