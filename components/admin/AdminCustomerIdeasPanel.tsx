"use client";

import { useEffect, useMemo, useState } from "react";
import { customerIdeaLines } from "@/lib/customer-ideas";
import type { MockupDocument } from "@/lib/mockup-types";

type IdeaRow = {
  id: string;
  title: string;
  kind: "idea" | "upload" | "detail";
  message: string;
  fileName?: string;
};

export function AdminCustomerIdeasPanel({
  requestId,
  artworkInstructions,
  customerNotes,
}: {
  requestId: string;
  artworkInstructions?: string | null;
  customerNotes?: string | null;
}) {
  const [document, setDocument] = useState<MockupDocument | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/mockups?requestId=${encodeURIComponent(requestId)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => { if (alive) setDocument(result?.document || null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [requestId]);

  const rows = useMemo(() => {
    const result: IdeaRow[] = [];
    for (const view of document?.views || []) {
      const intent = view.customerIntent;
      if (!intent?.enabled) continue;
      const title = [view.template?.productName || view.name, view.template?.colorName, view.template?.viewKey === "back" ? "Back" : view.template?.viewKey === "front" ? "Front" : null].filter(Boolean).join(" · ");
      if (intent.source === "idea" && intent.idea?.trim()) result.push({ id: `${view.id}-idea`, title, kind: "idea", message: intent.idea.trim() });
      if (intent.source === "upload" && intent.artworkFileName?.trim()) result.push({ id: `${view.id}-upload`, title, kind: "upload", message: "Use the customer’s uploaded artwork and placement.", fileName: intent.artworkFileName.trim() });
      if (intent.details?.trim()) result.push({ id: `${view.id}-details`, title, kind: "detail", message: intent.details.trim() });
      if (view.template?.designRelationship === "separate") result.push({ id: `${view.id}-separate`, title, kind: "idea", message: view.template.orderItemNotes?.trim() || "Customer requested a different design for this item." });
    }
    if (!result.length) {
      customerIdeaLines(artworkInstructions).forEach((message, index) => {
        const uploadedFile = message.match(/uploaded artwork:\s*([^;]+)/i)?.[1]?.trim();
        result.push({ id: `saved-${index}`, title: "Saved customer direction", kind: /design needed:/i.test(message) ? "idea" : uploadedFile ? "upload" : "detail", message, fileName: uploadedFile });
      });
    }
    return result;
  }, [document, artworkInstructions]);

  const designCount = rows.filter((row) => row.kind === "idea").length;
  if (!rows.length && !customerNotes?.trim()) return null;

  return (
    <section className="adminCustomerIdeaBrief" aria-label="Customer ideas and instructions">
      <div className="adminCustomerIdeaBriefHead">
        <div><span className="eyebrow">Review before mockup or quote</span><h4>Customer ideas & artwork directions</h4><p>Everything the customer asked for is pulled forward here so a tote, back design, note, or separate design does not get buried.</p></div>
        <span className={designCount ? "needsDesign" : "readyArtwork"}>{designCount ? `${designCount} design idea${designCount === 1 ? "" : "s"}` : "Artwork directions"}</span>
      </div>
      {rows.length ? <div className="adminCustomerIdeaRows">{rows.map((row) => <article className={`adminCustomerIdeaRow is-${row.kind}`} key={row.id}>
        <span>{row.kind === "idea" ? "CREATE" : row.kind === "upload" ? "FILE" : "NOTE"}</span>
        <div><strong>{row.title}</strong><p>{row.message}</p>{row.fileName ? <small>Original file: {row.fileName}</small> : null}</div>
      </article>)}</div> : null}
      {customerNotes?.trim() ? <div className="adminCustomerNoteCallout"><strong>Customer’s overall order note</strong><p>{customerNotes.trim()}</p></div> : null}
    </section>
  );
}
