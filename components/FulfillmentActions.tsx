"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RequestStatus } from "@/lib/custom-request-types";
import type { ShippingAddress } from "@/lib/order-types";

type FulfillmentMode = "pickup" | "delivery" | "shipping";

type Props = {
  id: string;
  requestNumber: string;
  initialStatus: RequestStatus;
  delivery: string | null;
  shippingAddress?: ShippingAddress | null;
  initialTrackingNumber?: string | null;
  initialTrackingUrl?: string | null;
  initialNote?: string | null;
  initialEstimatedDate?: string | null;
  initialEstimatedNote?: string | null;
  initialEstimatedNotifiedAt?: string | null;
  initialEstimatedNotifiedForDate?: string | null;
  paymentStatus: "unpaid" | "deposit_paid" | "paid";
};

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(date);
}

function initialModeFor(delivery: string | null, status: RequestStatus): FulfillmentMode | "" {
  const value = String(delivery || "").toLowerCase();
  if (status === "shipped" || value.includes("ship")) return "shipping";
  if (value.includes("delivery")) return "delivery";
  if (value.includes("pickup")) return "pickup";
  return "";
}

function savedDeliveryLabel(mode: FulfillmentMode) {
  if (mode === "shipping") return "Shipping";
  if (mode === "delivery") return "Local delivery";
  return "Local pickup";
}

export function FulfillmentActions({
  id,
  requestNumber,
  initialStatus,
  delivery,
  shippingAddress,
  initialTrackingNumber,
  initialTrackingUrl,
  initialNote,
  initialEstimatedDate,
  initialEstimatedNote,
  initialEstimatedNotifiedAt,
  initialEstimatedNotifiedForDate,
  paymentStatus,
}: Props) {
  const router = useRouter();
  const initialSavedMode = initialModeFor(delivery, initialStatus);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<FulfillmentMode | "">(initialSavedMode);
  const [savedMode, setSavedMode] = useState<FulfillmentMode | "">(initialSavedMode);
  const [methodWorking, setMethodWorking] = useState(false);
  const [methodMessage, setMethodMessage] = useState("");
  const [methodError, setMethodError] = useState("");
  const [address, setAddress] = useState<ShippingAddress>({
    name: shippingAddress?.name || "",
    line1: shippingAddress?.line1 || "",
    line2: shippingAddress?.line2 || "",
    city: shippingAddress?.city || "",
    state: shippingAddress?.state || "",
    postalCode: shippingAddress?.postalCode || "",
    country: shippingAddress?.country || "US",
  });
  const [trackingNumber, setTrackingNumber] = useState(initialTrackingNumber ?? "");
  const [trackingUrl, setTrackingUrl] = useState(initialTrackingUrl ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [estimatedDate, setEstimatedDate] = useState(initialEstimatedDate ?? "");
  const [estimatedNote, setEstimatedNote] = useState(initialEstimatedNote ?? "");
  const [estimateWorking, setEstimateWorking] = useState(false);
  const [estimateMessage, setEstimateMessage] = useState("");
  const [estimateError, setEstimateError] = useState("");
  const [estimatedNotifiedAt, setEstimatedNotifiedAt] = useState(initialEstimatedNotifiedAt ?? null);
  const [estimatedNotifiedForDate, setEstimatedNotifiedForDate] = useState(initialEstimatedNotifiedForDate ?? null);

  const methodLocked = initialStatus === "shipped" || initialStatus === "completed";
  const addressComplete = Boolean(address.line1.trim() && address.city.trim() && address.state.trim() && address.postalCode.trim() && address.country.trim());
  const estimateLabel = mode === "shipping" ? "Estimated ship date" : mode === "delivery" ? "Estimated delivery-ready date" : "Estimated pickup-ready date";
  const finalLabel = mode === "shipping" ? "Shipped" : mode === "delivery" ? "Ready for delivery" : "Ready for pickup";
  const noteLabel = mode === "shipping" ? "Shipping note" : mode === "delivery" ? "Delivery instructions / note" : "Pickup instructions / note";
  const notePlaceholder = mode === "shipping"
    ? "Anything the customer should know about this shipment."
    : mode === "delivery"
      ? "Example: Your order is ready for local delivery. We’ll coordinate the drop-off time with you."
      : "Example: Your order is ready. Please call or text before pickup.";

  async function chooseMode(nextMode: FulfillmentMode) {
    if (methodLocked) return;
    const previous = mode;
    setMode(nextMode);
    if ((nextMode === "shipping" || nextMode === "delivery") && !addressComplete) {
      setMethodMessage("");
      setMethodError(`Complete the ${nextMode === "shipping" ? "shipping" : "local delivery"} address below, then save the fulfillment method.`);
      return;
    }
    if (nextMode === savedMode && nextMode === "pickup") return;
    setMethodWorking(true);
    setMethodMessage("");
    setMethodError("");
    try {
      const response = await fetch("/api/admin/fulfillment-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, mode: nextMode, shippingAddress: address }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not save the fulfillment method.");
      setSavedMode(nextMode);
      setMethodMessage(`${savedDeliveryLabel(nextMode)} saved.`);
      router.refresh();
    } catch (err) {
      setMode(previous);
      setMethodError(err instanceof Error ? err.message : "Could not save the fulfillment method.");
    } finally {
      setMethodWorking(false);
    }
  }

  async function saveEstimate(notify: boolean) {
    if (!estimatedDate) {
      setEstimateError("Choose an estimated date first.");
      return;
    }
    setEstimateWorking(true);
    setEstimateMessage("");
    setEstimateError("");
    try {
      const response = await fetch("/api/admin/fulfillment-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, estimatedDate, estimatedNote, notify }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save the estimate.");
      setEstimatedNotifiedAt(result.notifiedAt ?? estimatedNotifiedAt);
      setEstimatedNotifiedForDate(result.notifiedForDate ?? estimatedNotifiedForDate);
      setEstimateMessage(notify ? "Estimate saved and customer emailed." : "Estimate saved. Customer was not emailed.");
      router.refresh();
    } catch (err) {
      setEstimateError(err instanceof Error ? err.message : "Could not save the estimate.");
    } finally {
      setEstimateWorking(false);
    }
  }

  async function notifyCustomer() {
    if (!mode) {
      setError("Choose and save a fulfillment method first.");
      return;
    }
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
      setMessage(mode === "shipping" ? "Shipped email sent." : mode === "delivery" ? "Ready-for-delivery email sent." : "Ready-for-pickup email sent.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send fulfillment notification.");
    } finally {
      setWorking(false);
    }
  }

  const currentEstimateWasEmailed = Boolean(estimatedDate && estimatedNotifiedForDate === estimatedDate);

  const fulfillmentAvailable = ["approved", "in_production", "ready", "shipped", "completed"].includes(initialStatus);

  return <div className="fulfillmentStack" id={`fulfillment-${id}`}>
    <section className="fulfillmentPanel">
      <div className="fulfillmentBody">
        <div className="estimatedFulfillmentHead">
          <div><span className="eyebrow">Fulfillment method</span><strong>How will this order reach the customer?</strong></div>
          {methodWorking ? <span className="estimateStatus">Saving…</span> : methodMessage ? <span className="estimateStatus isSent">Saved</span> : null}
        </div>
        <p className="fieldHelp">This controls the estimate wording, final button, customer email, account status, and whether tracking is requested.</p>
        {!savedMode ? <div className="requestWarning">Required before automatic sales tax: choose how this order will reach the customer. Your choice saves immediately.</div> : null}
        {savedMode && ["approved", "in_production", "ready"].includes(initialStatus) ? <div className="fieldHelp">Changing fulfillment updates the address used for the final tax check. It does not automatically invent a new shipping/delivery charge; revise the customer quote first if Moore Made needs to charge a different amount.</div> : null}
        <div className="fulfillmentMode">
          <button type="button" disabled={methodWorking || methodLocked} className={mode === "pickup" ? "active" : ""} onClick={() => void chooseMode("pickup")}>Local pickup</button>
          <button type="button" disabled={methodWorking || methodLocked} className={mode === "delivery" ? "active" : ""} onClick={() => void chooseMode("delivery")}>Local delivery</button>
          <button type="button" disabled={methodWorking || methodLocked} className={mode === "shipping" ? "active" : ""} onClick={() => void chooseMode("shipping")}>Shipping</button>
        </div>
        {mode === "shipping" || mode === "delivery" ? <div className="fulfillmentAddressEditor">
          <strong>{mode === "shipping" ? "Shipping address" : "Local delivery address"}</strong>
          <div className="twoCol">
            <label className="field"><span>Street *</span><input disabled={methodLocked} value={address.line1} onChange={(event) => setAddress((current) => ({ ...current, line1: event.target.value }))} /></label>
            <label className="field"><span>Apt / Suite <small>(optional)</small></span><input disabled={methodLocked} value={address.line2} onChange={(event) => setAddress((current) => ({ ...current, line2: event.target.value }))} /></label>
          </div>
          <div className="three">
            <label className="field"><span>City *</span><input disabled={methodLocked} value={address.city} onChange={(event) => setAddress((current) => ({ ...current, city: event.target.value }))} /></label>
            <label className="field"><span>State *</span><input disabled={methodLocked} maxLength={2} value={address.state} onChange={(event) => setAddress((current) => ({ ...current, state: event.target.value.toUpperCase() }))} /></label>
            <label className="field"><span>ZIP *</span><input disabled={methodLocked} value={address.postalCode} onChange={(event) => setAddress((current) => ({ ...current, postalCode: event.target.value }))} /></label>
          </div>
          <button className="btn secondary" type="button" disabled={methodWorking || methodLocked || !addressComplete} onClick={() => void chooseMode(mode)}>{methodWorking ? "Saving…" : "Save fulfillment + address"}</button>
        </div> : null}
        {methodLocked ? <div className="fieldHelp">The fulfillment method is locked after an order is shipped or completed.</div> : null}
        {methodMessage ? <div className="quoteSuccess">{methodMessage}</div> : null}
        {methodError ? <div className="formError">{methodError}</div> : null}
      </div>
    </section>

    {initialStatus === "in_production" ? <section className="estimatedFulfillmentPanel">
      <div className="estimatedFulfillmentHead">
        <div><span className="eyebrow">Production estimate</span><strong>{estimateLabel}</strong></div>
        {currentEstimateWasEmailed ? <span className="estimateStatus isSent">Customer notified</span> : <span className="estimateStatus">Not emailed yet</span>}
      </div>
      <div className="twoCol estimatedFulfillmentFields">
        <label className="field"><span>{estimateLabel}</span><input type="date" value={estimatedDate} onChange={(event) => setEstimatedDate(event.target.value)} /></label>
        <label className="field"><span>Customer note <small>(optional)</small></span><input value={estimatedNote} maxLength={1500} onChange={(event) => setEstimatedNote(event.target.value)} placeholder="Example: Production is on schedule." /></label>
      </div>
      <div className="estimateDisclaimer">{mode === "shipping"
        ? "Estimated only — not guaranteed. This is the date Moore Made expects to hand the package to the carrier. It is not a guaranteed delivery date, and carrier transit/delivery timing cannot be guaranteed."
        : mode === "delivery"
          ? "Estimated only — not guaranteed. The customer will receive a separate notification when the order is officially ready for local delivery."
          : "Estimated only — not guaranteed. The customer will receive a separate notification when the order is officially ready for pickup."}</div>
      {estimatedNotifiedAt ? <div className="fieldHelp">Last estimate email: {localDateTime(estimatedNotifiedAt)}{!currentEstimateWasEmailed ? " · The current date has not been emailed yet." : ""}</div> : null}
      {estimateError ? <div className="formError">{estimateError}</div> : null}
      {estimateMessage ? <div className="quoteSuccess">{estimateMessage}</div> : null}
      <div className="estimatedFulfillmentActions">
        <button className="btn secondary" type="button" disabled={estimateWorking || methodWorking} onClick={() => void saveEstimate(false)}>{estimateWorking ? "Saving…" : "Save estimate"}</button>
        <button className="btn" type="button" disabled={estimateWorking || methodWorking} onClick={() => void saveEstimate(true)}>{estimateWorking ? "Working…" : "Save & notify customer"}</button>
      </div>
    </section> : null}

    {fulfillmentAvailable ? <div className="fulfillmentPanel">
      <button className="fulfillmentToggle" type="button" onClick={() => setOpen((value) => !value)}>
        <span><strong>Final customer notification</strong><small>{initialStatus === "ready" ? (mode === "delivery" ? "Ready for delivery sent" : "Ready for pickup sent") : initialStatus === "shipped" ? "Shipped notification sent" : `Send when the order is finished · ${finalLabel}`}</small></span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open ? <div className="fulfillmentBody">
        <p className="fieldHelp">This is the final fulfillment email. A production estimate is not the same as marking the order ready or shipped.</p>
        {paymentStatus !== "paid" ? <div className="requestWarning">Balance due: this order cannot be marked ready for pickup, ready for delivery, or shipped until it is paid in full.</div> : null}
        <div className="orderNotificationNotice"><strong>{finalLabel}</strong><span>{mode === "delivery" ? "The customer will be told that Moore Made is ready to complete the local delivery. Add drop-off details below if helpful." : mode === "pickup" ? "The customer will be told their order is ready for local pickup." : "The customer will be told the order has shipped. Tracking is optional but recommended."}</span></div>
        {mode === "shipping" ? <div className="twoCol fulfillmentTracking">
          <label className="field"><span>Tracking number <small>(optional)</small></span><input value={trackingNumber} maxLength={200} onChange={(e) => setTrackingNumber(e.target.value)} placeholder="1Z…" /></label>
          <label className="field"><span>Tracking link <small>(optional)</small></span><input value={trackingUrl} maxLength={1000} onChange={(e) => setTrackingUrl(e.target.value)} placeholder="https://…" /></label>
        </div> : null}
        <label className="field"><span>{noteLabel} <small>(optional)</small></span><textarea value={note} maxLength={3000} onChange={(e) => setNote(e.target.value)} placeholder={notePlaceholder} /></label>
        {error ? <div className="formError">{error}</div> : null}
        {message ? <div className="quoteSuccess">{message}</div> : null}
        <button className="btn" type="button" disabled={working || methodWorking || paymentStatus !== "paid" || !savedMode} onClick={notifyCustomer}>{working ? "Sending…" : mode === "shipping" ? `Mark shipped + email ${requestNumber}` : mode === "delivery" ? `Mark ready for delivery + email ${requestNumber}` : `Mark ready for pickup + email ${requestNumber}`}</button>
      </div> : null}
    </div> : <p className="muted adminFulfillmentLocked">Choose the fulfillment method now for tax. Final customer notifications become available after the proof + quote is approved.</p>}
  </div>;
}
