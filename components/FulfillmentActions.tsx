"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RequestStatus } from "@/lib/custom-request-types";

type Props = {
  id: string;
  requestNumber: string;
  initialStatus: RequestStatus;
  delivery: string | null;
  initialTrackingNumber?: string | null;
  initialTrackingUrl?: string | null;
  initialNote?: string | null;
  paymentStatus: "unpaid" | "deposit_paid" | "paid";
};

export function FulfillmentActions({ id, requestNumber, initialStatus, delivery, initialTrackingNumber, initialTrackingUrl, initialNote, paymentStatus }: Props) {
  const router = useRouter();
  const defaultShip = (delivery || "").toLowerCase().includes("ship");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"pickup" | "shipped">(initialStatus === "shipped" || defaultShip ? "shipped" : "pickup");
  const [trackingNumber, setTrackingNumber] = useState(initialTrackingNumber ?? "");
  const [trackingUrl, setTrackingUrl] = useState(initialTrackingUrl ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function notifyCustomer() {
    setWorking(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, mode, trackingNumber, trackingUrl, note }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not send fulfillment notification.");
      setMessage(mode === "pickup" ? "Ready-for-pickup email sent." : "Shipped email sent.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send fulfillment notification.");
    } finally {
      setWorking(false);
    }
  }

  return <div className="fulfillmentPanel">
    <button className="fulfillmentToggle" type="button" onClick={() => setOpen((value) => !value)}>
      <span><strong>Final customer notification</strong><small>{initialStatus === "ready" ? "Ready for pickup sent" : initialStatus === "shipped" ? "Shipped notification sent" : "Send when the order is finished"}</small></span>
      <span>{open ? "−" : "+"}</span>
    </button>
    {open ? <div className="fulfillmentBody">
      <p className="fieldHelp">This is intended to be the next customer email after proof approval and payment.</p>
      {paymentStatus !== "paid" ? <div className="requestWarning">Balance due: this order cannot be marked ready for pickup or shipped until it is paid in full.</div> : null}
      <div className="fulfillmentMode">
        <button type="button" className={mode === "pickup" ? "active" : ""} onClick={() => setMode("pickup")}>Ready for pickup</button>
        <button type="button" className={mode === "shipped" ? "active" : ""} onClick={() => setMode("shipped")}>Shipped</button>
      </div>
      {mode === "shipped" ? <div className="twoCol fulfillmentTracking">
        <label className="field"><span>Tracking number <small>(optional)</small></span><input value={trackingNumber} maxLength={200} onChange={(e) => setTrackingNumber(e.target.value)} placeholder="1Z…" /></label>
        <label className="field"><span>Tracking link <small>(optional)</small></span><input value={trackingUrl} maxLength={1000} onChange={(e) => setTrackingUrl(e.target.value)} placeholder="https://…" /></label>
      </div> : null}
      <label className="field"><span>{mode === "pickup" ? "Pickup instructions / note" : "Shipping note"} <small>(optional)</small></span><textarea value={note} maxLength={3000} onChange={(e) => setNote(e.target.value)} placeholder={mode === "pickup" ? "Example: Your order is ready. Please call or text before pickup." : "Anything the customer should know about this shipment."} /></label>
      {error ? <div className="formError">{error}</div> : null}
      {message ? <div className="quoteSuccess">{message}</div> : null}
      <button className="btn" type="button" disabled={working || paymentStatus !== "paid"} onClick={notifyCustomer}>{working ? "Sending…" : mode === "pickup" ? `Mark ready + email ${requestNumber}` : `Mark shipped + email ${requestNumber}`}</button>
    </div> : null}
  </div>;
}
