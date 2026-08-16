"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REQUEST_STATUSES, REQUEST_STATUS_LABELS } from "@/lib/custom-request-types";
import type { RequestStatus } from "@/lib/custom-request-types";

export function RequestStatusControl({ id, initialStatus }: { id: string; initialStatus: RequestStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState<RequestStatus>(initialStatus);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

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
      setStatus(previous);
      setMessage(body.error || "Could not save");
    } else {
      setMessage("Saved");
      router.refresh();
    }
    setSaving(false);
  }

  return (
    <div className="statusControl">
      <select value={status} onChange={(e) => updateStatus(e.target.value as RequestStatus)} disabled={saving}>
        {REQUEST_STATUSES.map((value) => <option value={value} key={value}>{REQUEST_STATUS_LABELS[value]}</option>)}
      </select>
      <span className="statusSaveMessage">{saving ? "Saving…" : message}</span>
    </div>
  );
}
