"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  requestId: string;
  quantity: number;
  sizes: string | null;
  colors: string | null;
  printSides: string | null;
  placements: string[] | null;
  status: string;
  paymentStatus: string;
  quoteStatus: string | null;
  structuredItemCount: number;
};

function sizeCount(value: string): number | null {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  let count = 0;
  const seen = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^(?:[-*]\s*)?(.+?)\s*:\s*(\d+)$/);
    if (!match) return null;
    const name = match[1].trim().toLowerCase();
    const amount = Number(match[2]);
    if (!name || seen.has(name) || !Number.isSafeInteger(amount) || amount < 1 || amount > 10000) return null;
    seen.add(name);
    count += amount;
  }
  return count;
}

export function AdminOrderDetailsEditor({ requestId, quantity, sizes, colors, printSides, placements, status, paymentStatus, quoteStatus, structuredItemCount }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [sizeText, setSizeText] = useState(sizes ?? "");
  const [colorText, setColorText] = useState(colors ?? "");
  const [sideText, setSideText] = useState(printSides ?? "");
  const [placementText, setPlacementText] = useState((placements ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const count = sizeCount(sizeText);
  const locked = !["new", "reviewing"].includes(status) || paymentStatus !== "unpaid" || (quoteStatus !== null && quoteStatus !== "draft");
  const hasStructuredItems = structuredItemCount > 0;

  async function save() {
    if (saving || locked || hasStructuredItems) return;
    setError("");
    if (count === null) { setError("Use one size per line, such as XL: 3."); return; }
    if (count !== quantity) { setError(`The sizes add up to ${count}, but this order has ${quantity} shirts. Correct the breakdown before saving.`); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/admin/order-details", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: requestId, sizes: sizeText, colors: colorText, print_sides: sideText, placements: placementText }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not save order details.");
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save order details.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="adminOrderDetailsEditor">
    {locked ? <p className="fieldHelp">Order details are locked after the quote is sent or payment begins. Use a formal quote revision for changes.</p> :
      hasStructuredItems ? <p className="fieldHelp">This order contains multiple structured product fields. Editing those sizes needs the full item editor so production quantities stay consistent.</p> :
      !editing ? <button type="button" className="btn secondary" onClick={() => setEditing(true)}>Edit order details</button> :
      <div className="adminOrderDetailsEditorForm">
        <strong>Correct the current order</strong>
        <p className="fieldHelp">These details appear on the customer preview and Pro Forma. The total quantity and quote price stay unchanged.</p>
        <label>Sizes and quantities
          <textarea value={sizeText} onChange={(event) => setSizeText(event.target.value)} placeholder={"18 months: 1\nMedium: 1\nLarge: 9\nXL: 3"} />
          <small className="fieldHelp">{count === null ? "Use one size per line (e.g. XL: 3)." : `${count} of ${quantity} shirts accounted for.`}</small>
        </label>
        <label>Color<input value={colorText} maxLength={120} onChange={(event) => setColorText(event.target.value)} placeholder="Black" /></label>
        <label>Front / back<input value={sideText} maxLength={80} onChange={(event) => setSideText(event.target.value)} placeholder="Front only" /></label>
        <label>Placement (comma-separated)<input value={placementText} maxLength={300} onChange={(event) => setPlacementText(event.target.value)} placeholder="full-front" /></label>
        {error ? <p role="alert" className="adminOrderDetailsEditorError">{error}</p> : null}
        <div className="adminOrderDetailsEditorActions">
          <button type="button" className="btn" onClick={save} disabled={saving || count !== quantity}>{saving ? "Saving…" : "Save corrected details"}</button>
          <button type="button" className="btn secondary" disabled={saving} onClick={() => { setEditing(false); setError(""); }}>Cancel</button>
        </div>
      </div>}
  </div>;
}
