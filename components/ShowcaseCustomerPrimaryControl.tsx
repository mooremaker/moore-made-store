"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ShowcaseStatus } from "@/lib/showcase-types";

export function ShowcaseCustomerPrimaryControl({
  id,
  status,
  primary,
}: {
  id: string;
  status: ShowcaseStatus;
  primary: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canSelect = status === "approved";

  async function update(nextPrimary: boolean) {
    if (!canSelect && nextPrimary) return;
    setSaving(true);
    setError("");
    const response = await fetch("/api/admin/showcase-primary", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, primary: nextPrimary }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError(data.error || "Could not update the main customer review.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="showcaseHomepageFeatureControl">
      {primary ? (
        <button type="button" className="btn secondary showcaseFeaturedButton isFeatured" disabled={saving} onClick={() => update(false)}>
          {saving ? "Saving…" : "★ Main customer review"}
        </button>
      ) : (
        <button type="button" className="btn secondary showcaseFeaturedButton" disabled={saving || !canSelect} onClick={() => update(true)} title={canSelect ? "Show this review first for this customer" : "Approve this review before selecting it"}>
          {saving ? "Saving…" : "Make main review"}
        </button>
      )}
      {!canSelect && !primary ? <small>Approve first</small> : null}
      {error ? <small className="formError showcaseFeatureError">{error}</small> : null}
    </div>
  );
}
