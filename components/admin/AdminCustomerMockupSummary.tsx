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

  if (loading) return <div className="adminMockupSummaryLoading">Checking customer mockup…</div>;
  if (!document?.views?.length) {
    return <div className="adminMockupStatus isMissing"><strong>No customer mockup completed</strong><span>The customer did not finish a saved mockup. Review their order notes, then create and send a proof before quoting.</span></div>;
  }

  const requestedViews = document.views.filter((view) => view.customerIntent?.enabled);
  const completedViews = requestedViews.filter((view) => view.layers.length > 0 || (view.vectorLayers?.length ?? 0) > 0);
  const hasCustomerMockup = requestedViews.length > 0 || document.source === "customer";
  const isComplete = hasCustomerMockup && (completedViews.length > 0 || document.views.some((view) => view.layers.length > 0 || (view.vectorLayers?.length ?? 0) > 0));
  const status = isComplete
    ? <div className="adminMockupStatus isComplete"><strong>Customer mockup completed</strong><span>{completedViews.length ? `${completedViews.length} design side${completedViews.length === 1 ? "" : "s"} saved with placement details.` : "A saved customer design is ready for your review."}</span></div>
    : hasCustomerMockup
      ? <div className="adminMockupStatus isAttention"><strong>Artwork uploaded — mockup not completed</strong><span>The customer started customizing but did not save artwork onto the mockup. Use their upload and notes to create a proof before quoting.</span></div>
      : <div className="adminMockupStatus isMissing"><strong>No customer mockup completed</strong><span>The customer did not finish a saved mockup. Review their order notes, then create and send a proof before quoting.</span></div>;

  return <>
    {status}
    {hasCustomerMockup ? <SavedMockupPreview document={document} compact title="Customer-created mockup" className="adminCustomerMockupPreview" /> : null}
  </>;
}
