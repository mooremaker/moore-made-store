"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REQUEST_STATUSES, REQUEST_STATUS_LABELS } from "@/lib/custom-request-types";
import type { RequestStatus } from "@/lib/custom-request-types";

export function RequestStatusControl({ id, initialStatus, delivery, initialReviewRequestSentAt }: { id: string; initialStatus: RequestStatus; delivery?: string | null; initialReviewRequestSentAt?: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<RequestStatus>(initialStatus);
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState("");
  const [reviewRequestSentAt, setReviewRequestSentAt] = useState(initialReviewRequestSentAt || null);
  const readyLabel = String(delivery || "").toLowerCase().includes("delivery") ? "Ready for delivery" : "Ready for pickup";

  async function updateStatus(nextStatus: RequestStatus) {
    if (nextStatus === "ready" || nextStatus === "shipped") {
      setMessage("Use final notification below");
      return;
    }
    const previous = status;
    setStatus(nextStatus);
    setSaving(true);
    setMessage("");

    const response = await fetch("/api/admin/request-status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: nextStatus }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (!body.saved) setStatus(previous);
      setMessage(body.error || "Could not save");
    } else {
      const body = await response.json().catch(() => ({}));
      if (body.reviewRequestSent) setReviewRequestSentAt(body.reviewRequestSentAt || new Date().toISOString());
      setMessage(body.reviewRequestSent ? "Saved · review email sent" : "Saved");
      router.refresh();
    }
    setSaving(false);
  }

  async function resendReviewRequest() {
    setResending(true); setMessage("");
    const response = await fetch("/api/admin/review-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) setReviewRequestSentAt(body.sentAt || new Date().toISOString());
    setMessage(response.ok ? "Review email resent" : body.error || "Could not resend review email");
    setResending(false);
  }

  return (
    <div className="statusControl">
      <select value={status} onChange={(e) => updateStatus(e.target.value as RequestStatus)} disabled={saving}>
        {REQUEST_STATUSES.map((value) => <option value={value} key={value}>{value === "ready" ? readyLabel : REQUEST_STATUS_LABELS[value]}</option>)}
      </select>
      {status === "completed" ? <><button className="textButton" type="button" disabled={saving || resending} onClick={() => void resendReviewRequest()}>{resending ? "Sending…" : "Resend review email"}</button><small className={reviewRequestSentAt ? "reviewEmailSentStatus" : "reviewEmailMissingStatus"}>{reviewRequestSentAt ? `Review email sent ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(reviewRequestSentAt))}` : "Review email not sent yet"}</small></> : null}
      <span className="statusSaveMessage">{saving ? "Saving…" : message}</span>
    </div>
  );
}
