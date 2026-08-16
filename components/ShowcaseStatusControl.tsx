"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ShowcaseStatus } from "@/lib/showcase-types";

export function ShowcaseStatusControl({ id, initialStatus }: { id: string; initialStatus: ShowcaseStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);

  async function update(next: ShowcaseStatus) {
    const previous = status;
    setStatus(next);
    setSaving(true);
    const response = await fetch("/api/admin/showcase-status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: next }),
    });
    setSaving(false);
    if (!response.ok) {
      setStatus(previous);
      return;
    }
    router.refresh();
  }

  return (
    <div className="statusControl">
      <select value={status} onChange={(e) => update(e.target.value as ShowcaseStatus)} disabled={saving} aria-label="Made by You approval status">
        <option value="pending">Pending review</option>
        <option value="approved">Approved / publish</option>
        <option value="rejected">Rejected / hidden</option>
      </select>
      <span className="statusSaveMessage">{saving ? "Saving…" : ""}</span>
    </div>
  );
}
