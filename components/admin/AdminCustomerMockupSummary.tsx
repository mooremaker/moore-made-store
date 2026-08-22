"use client";

import { useEffect, useState } from "react";
import { SavedMockupPreview } from "@/components/mockups/SavedMockupPreview";
import type { MockupDocument } from "@/lib/mockup-types";

export function AdminCustomerMockupSummary({ requestId }: { requestId: string }) {
  const [document, setDocument] = useState<MockupDocument | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/mockups?requestId=${encodeURIComponent(requestId)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => { if (alive) setDocument(result?.document || null); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [requestId]);

  if (loading) return <div className="adminMockupSummaryLoading">Loading customer mockup…</div>;
  if (!document?.views?.length) return null;

  return <SavedMockupPreview document={document} compact title="Customer-created mockup" className="adminCustomerMockupPreview" />;
}
