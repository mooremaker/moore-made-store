"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ShowcaseStatus } from "@/lib/showcase-types";

export function ShowcaseHomepageFeatureControl({
  id,
  status,
  featured,
}: {
  id: string;
  status: ShowcaseStatus;
  featured: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canFeature = status === "approved";

  async function update(nextFeatured: boolean) {
    if (!canFeature && nextFeatured) return;
    setSaving(true);
    setError("");
    const response = await fetch("/api/admin/showcase-feature", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, featured: nextFeatured }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError(data.error || "Could not update the homepage feature.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="showcaseHomepageFeatureControl">
      {featured ? (
        <button type="button" className="btn secondary showcaseFeaturedButton isFeatured" disabled={saving} onClick={() => update(false)}>
          {saving ? "Saving…" : "★ Featured"}
        </button>
      ) : (
        <button type="button" className="btn secondary showcaseFeaturedButton" disabled={saving || !canFeature} onClick={() => update(true)} title={canFeature ? "Use this as the homepage review" : "Approve this review before featuring it"}>
          {saving ? "Saving…" : "Feature homepage"}
        </button>
      )}
      {!canFeature && !featured ? <small>Approve first</small> : null}
      {error ? <small className="formError showcaseFeatureError">{error}</small> : null}
    </div>
  );
}
