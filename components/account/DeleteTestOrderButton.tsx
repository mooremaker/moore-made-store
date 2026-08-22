"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteTestOrderButton({ requestId, requestNumber }: { requestId: string; requestNumber: string }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (!window.confirm(`Permanently delete your cancelled test order ${requestNumber}? Its test quote and related draft records will also be removed. This cannot be undone.`)) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/test-orders/${encodeURIComponent(requestId)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not delete the test order.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the test order.");
    } finally {
      setWorking(false);
    }
  }

  return <div className="accountAdminDeleteOrder">
    <button className="btn secondary dangerButton" type="button" disabled={working} onClick={() => void remove()}>{working ? "Deleting…" : "Delete test order"}</button>
    {error ? <small className="formError compactError">{error}</small> : null}
  </div>;
}
