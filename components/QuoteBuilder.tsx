"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import {
  money,
  QUOTE_STATUS_LABELS,
  type QuoteLineItem,
  type QuoteProofAsset,
  type QuoteRecord,
} from "@/lib/quote-types";

const PROOF_BUCKET = "quote-proof-files";
const MAX_PROOF_FILE_BYTES = 20 * 1024 * 1024;
const UPLOAD_BATCH_SIZE = 50;

type Props = {
  requestId: string;
  requestNumber: string;
  product: string;
  quantity: number;
  existingQuote?: QuoteRecord | null;
};

type EditableLine = { description: string; quantity: string; unitPrice: string };
type EditableProofItem = {
  clientKey: string;
  dbId?: string;
  title: string;
  notes: string;
  assets: QuoteProofAsset[];
  newFiles: File[];
};

function centsFromInput(value: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

function dollars(cents: number | undefined) {
  return cents ? (cents / 100).toFixed(2) : "";
}

function newClientKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fileLabel(asset: QuoteProofAsset, index: number) {
  return asset.originalName || asset.path.split("/").pop() || `Proof ${index + 1}`;
}

export function QuoteBuilder({ requestId, requestNumber, product, quantity, existingQuote }: Props) {
  const router = useRouter();
  const waitingOnCustomer = existingQuote?.status === "sent";
  const locked = existingQuote?.status === "approved" || waitingOnCustomer;
  const [open, setOpen] = useState(Boolean(existingQuote));
  const [lines, setLines] = useState<EditableLine[]>(
    existingQuote?.line_items?.length
      ? existingQuote.line_items.map((item) => ({
          description: item.description,
          quantity: String(item.quantity),
          unitPrice: dollars(item.unitPriceCents),
        }))
      : [{ description: product, quantity: String(quantity || 1), unitPrice: "" }]
  );
  const [setupFee, setSetupFee] = useState(dollars(existingQuote?.setup_fee_cents));
  const [shipping, setShipping] = useState(dollars(existingQuote?.shipping_cents));
  const [tax, setTax] = useState(dollars(existingQuote?.tax_cents));
  const [discount, setDiscount] = useState(dollars(existingQuote?.discount_cents));
  const [notes, setNotes] = useState(existingQuote?.notes ?? "");
  const [validUntil, setValidUntil] = useState(existingQuote?.valid_until ?? "");
  const [paymentTerms, setPaymentTerms] = useState<"full" | "deposit">(existingQuote?.payment_terms === "deposit" ? "deposit" : "full");
  const [depositAmount, setDepositAmount] = useState(dollars(existingQuote?.deposit_amount_cents ?? undefined));
  const [proofItems, setProofItems] = useState<EditableProofItem[]>(() => {
    if (existingQuote?.proofItems?.length) {
      return existingQuote.proofItems.map((item) => ({
        clientKey: item.id || newClientKey(),
        dbId: item.id,
        title: item.title,
        notes: item.notes ?? "",
        assets: item.assets ?? [],
        newFiles: [],
      }));
    }
    return [{ clientKey: newClientKey(), title: product || "Order proof", notes: "", assets: [], newFiles: [] }];
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!existingQuote?.proofItems?.length) return;
    setProofItems(existingQuote.proofItems.map((item) => ({
      clientKey: item.id || newClientKey(),
      dbId: item.id,
      title: item.title,
      notes: item.notes ?? "",
      assets: item.assets ?? [],
      newFiles: [],
    })));
  }, [existingQuote?.updated_at, existingQuote?.proofItemsVersion]);

  const lineItems: QuoteLineItem[] = useMemo(
    () => lines.map((line) => ({
      description: line.description.trim(),
      quantity: Math.max(1, Math.floor(Number(line.quantity) || 1)),
      unitPriceCents: centsFromInput(line.unitPrice),
    })),
    [lines]
  );

  const subtotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const total = Math.max(0, subtotal + centsFromInput(setupFee) + centsFromInput(shipping) + centsFromInput(tax) - centsFromInput(discount));

  function updateLine(index: number, field: keyof EditableLine, value: string) {
    setLines((current) => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  }

  function updateProofItem(index: number, patch: Partial<EditableProofItem>) {
    setProofItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  function chooseProofs(index: number, files: FileList | null) {
    const selected = Array.from(files ?? []);
    setError("");
    const oversized = selected.find((file) => file.size > MAX_PROOF_FILE_BYTES);
    if (oversized) {
      setError(`${oversized.name} is larger than 20 MB.`);
      return;
    }
    updateProofItem(index, { newFiles: [...proofItems[index].newFiles, ...selected] });
  }

  function moveProofItem(index: number, direction: -1 | 1) {
    setProofItems((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
      return copy;
    });
  }

  async function uploadFilesForItem(item: EditableProofItem) {
    if (!item.newFiles.length) return item.assets;
    const supabase = getSupabaseBrowser();
    const uploaded: QuoteProofAsset[] = [];

    for (let offset = 0; offset < item.newFiles.length; offset += UPLOAD_BATCH_SIZE) {
      const batch = item.newFiles.slice(offset, offset + UPLOAD_BATCH_SIZE);
      const prepare = await fetch("/api/admin/quote-proof-uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          itemKey: item.clientKey,
          files: batch.map((file) => ({ name: file.name, size: file.size, type: file.type })),
        }),
      });
      const prepared = await prepare.json();
      if (!prepare.ok) throw new Error(prepared.error || "Could not prepare proof uploads.");

      for (const target of prepared.uploads ?? []) {
        const file = batch[target.index];
        if (!file) continue;
        const { error: uploadError } = await supabase.storage
          .from(PROOF_BUCKET)
          .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type || undefined });
        if (uploadError) throw new Error(`Could not upload ${file.name}.`);
        uploaded.push({ path: target.path, originalName: file.name });
      }
    }

    if (uploaded.length !== item.newFiles.length) throw new Error("One or more proof files did not upload.");
    return [...item.assets, ...uploaded];
  }

  async function buildProofPayload() {
    const result: Array<{ title: string; notes: string; assets: QuoteProofAsset[] }> = [];
    for (const item of proofItems) {
      const assets = await uploadFilesForItem(item);
      result.push({ title: item.title.trim(), notes: item.notes.trim(), assets });
    }
    return result;
  }

  async function submit(action: "save" | "send") {
    setError("");
    setMessage("");

    if (waitingOnCustomer) {
      setError("This proof + quote is already with the customer. Wait for approval or a change request before editing it.");
      return;
    }
    if (lineItems.some((item) => !item.description)) {
      setError("Every quote line needs a description.");
      return;
    }
    if (lineItems.some((item) => item.unitPriceCents <= 0)) {
      setError("Enter a unit price for each quote line.");
      return;
    }
    if (!proofItems.length || proofItems.some((item) => !item.title.trim())) {
      setError("Give every proof item a name, such as Employee Shirts or Business Cards.");
      return;
    }

    const depositCents = centsFromInput(depositAmount);
    if (paymentTerms === "deposit" && (depositCents <= 0 || depositCents >= total)) {
      setError("Custom deposit must be greater than $0 and less than the full quote total.");
      return;
    }

    setSaving(true);
    try {
      const proofPayload = await buildProofPayload();
      if (action === "send" && !proofPayload.some((item) => item.assets.length > 0)) {
        throw new Error("Upload at least one final mockup/proof before sending this approval.");
      }
      if (action === "send" && proofPayload.some((item) => item.assets.length === 0)) {
        throw new Error("Every proof item needs at least one mockup/image/PDF before the order can be sent for approval.");
      }

      const response = await fetch("/api/admin/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          action,
          lineItems,
          setupFeeCents: centsFromInput(setupFee),
          shippingCents: centsFromInput(shipping),
          taxCents: centsFromInput(tax),
          discountCents: centsFromInput(discount),
          paymentTerms,
          depositAmountCents: paymentTerms === "deposit" ? centsFromInput(depositAmount) : null,
          notes,
          proofItems: proofPayload,
          validUntil,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save proof and quote.");
      setProofItems((current) => current.map((item) => ({ ...item, newFiles: [] })));
      setMessage(result.message || (action === "send" ? "Proof and quote sent." : "Draft saved."));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save proof and quote.");
    } finally {
      setSaving(false);
    }
  }

  const latestChangeRequest = existingQuote?.changeRequests?.[0];
  const displayVersion = existingQuote?.proofItemsVersion || existingQuote?.proof_version || 1;

  return (
    <div className="quoteBuilder proofQuoteBuilder scalableProofBuilder">
      <button className="quoteToggle" type="button" onClick={() => setOpen((value) => !value)}>
        <span>
          <strong>{existingQuote ? "Proof + quote" : "Prepare proof + quote"}</strong>
          {existingQuote ? <small>{QUOTE_STATUS_LABELS[existingQuote.status]} · {money(existingQuote.total_cents)} · Proof v{displayVersion}</small> : <small>Mockups and price approval for {requestNumber}</small>}
        </span>
        <span>{open ? "−" : "+"}</span>
      </button>

      {open ? (
        <div className="quoteBuilderBody">
          {existingQuote?.status === "approved" ? <div className="quoteLocked">This proof and quote have been approved. Keep this version as the production reference.</div> : null}
          {waitingOnCustomer ? <div className="quoteLocked">This version is currently waiting on the customer. Editing is locked until they approve it or request changes.</div> : null}
          {latestChangeRequest ? (
            <div className="proofChangeRequest">
              <strong>Customer requested changes</strong>
              {latestChangeRequest.generalMessage ? <p>{latestChangeRequest.generalMessage}</p> : null}
              {latestChangeRequest.items.length ? <div className="adminItemChangeList">
                {latestChangeRequest.items.map((change, index) => <div key={`${change.proofItemTitle}-${index}`}><span>{change.proofItemTitle}</span><p>{change.message}</p></div>)}
              </div> : null}
              <span>Update only the affected proof items below, then resend the whole order for one final approval.</span>
            </div>
          ) : existingQuote?.customer_change_request ? (
            <div className="proofChangeRequest"><strong>Customer requested changes</strong><p>{existingQuote.customer_change_request}</p></div>
          ) : null}

          <section className="proofBuilderSection">
            <div className="proofBuilderHeading scalableProofHeading">
              <div><span className="eyebrow">Product proofs</span><h5>Build the customer&apos;s approval set</h5><p>Use one proof item per product/design. Each item can contain multiple views, pages, images, or PDFs.</p></div>
              <span className="proofVersionBadge">Version {displayVersion}</span>
            </div>

            <div className="proofItemEditorList">
              {proofItems.map((item, index) => {
                const totalFiles = item.assets.length + item.newFiles.length;
                return (
                  <details className="proofItemEditor" key={item.clientKey}>
                    <summary>
                      <div><span className="proofItemNumber">{String(index + 1).padStart(2, "0")}</span><strong>{item.title.trim() || "Untitled proof item"}</strong></div>
                      <span>{totalFiles} file{totalFiles === 1 ? "" : "s"}</span>
                    </summary>
                    <div className="proofItemEditorBody">
                      <div className="proofItemTopGrid">
                        <label className="field"><span>Product / proof name</span><input value={item.title} maxLength={300} onChange={(e) => updateProofItem(index, { title: e.target.value })} placeholder="Employee T-Shirts" disabled={locked} /></label>
                        <label className="field"><span>Proof notes</span><textarea value={item.notes} maxLength={5000} onChange={(e) => updateProofItem(index, { notes: e.target.value })} placeholder='Example: Front left-chest logo approx. 4" wide; full-back design approx. 11" wide.' disabled={locked} /></label>
                      </div>

                      {item.assets.length ? <div className="adminProofGrid proofItemAssetGrid">
                        {item.assets.map((asset, assetIndex) => {
                          const isPdf = asset.path.toLowerCase().endsWith(".pdf");
                          return <div className="adminProofThumb proofAssetEditable" key={`${asset.path}-${assetIndex}`}>
                            {asset.url ? <a href={asset.url} target="_blank" rel="noreferrer">{isPdf ? <div className="proofPdfTile">PDF<br /><small>{fileLabel(asset, assetIndex)}</small></div> : <img src={asset.url} alt={`${item.title} proof ${assetIndex + 1}`} />}</a> : <div className="proofPdfTile"><small>{fileLabel(asset, assetIndex)}</small></div>}
                            {!locked ? <button type="button" aria-label={`Remove ${fileLabel(asset, assetIndex)}`} onClick={() => updateProofItem(index, { assets: item.assets.filter((_, i) => i !== assetIndex) })}>×</button> : null}
                          </div>;
                        })}
                      </div> : null}

                      {item.newFiles.length ? <div className="proofSelectedFiles">{item.newFiles.map((file, fileIndex) => <span key={`${file.name}-${file.size}-${fileIndex}`}>{file.name}<button type="button" disabled={locked} onClick={() => updateProofItem(index, { newFiles: item.newFiles.filter((_, i) => i !== fileIndex) })}>×</button></span>)}</div> : null}

                      {!locked ? <div className="field">
                        <label htmlFor={`proofFiles-${item.clientKey}`}>Add mockup / proof files</label>
                        <input id={`proofFiles-${item.clientKey}`} type="file" multiple accept="image/*,.pdf" onChange={(e) => { chooseProofs(index, e.target.files); e.currentTarget.value = ""; }} />
                        <span className="fieldHelp">Images or PDFs, up to 20 MB each. You can add more files in additional selections; large orders are organized by proof item instead of one overall file limit.</span>
                      </div> : null}

                      {!locked ? <div className="proofItemActions">
                        <button type="button" className="textButton" disabled={index === 0} onClick={() => moveProofItem(index, -1)}>↑ Move up</button>
                        <button type="button" className="textButton" disabled={index === proofItems.length - 1} onClick={() => moveProofItem(index, 1)}>↓ Move down</button>
                        <button type="button" className="textButton dangerText" disabled={proofItems.length === 1} onClick={() => setProofItems((current) => current.filter((_, i) => i !== index))}>Remove item</button>
                      </div> : null}
                    </div>
                  </details>
                );
              })}
            </div>

            {!locked ? <button className="btn secondary addProofItemButton" type="button" onClick={() => setProofItems((current) => [...current, { clientKey: newClientKey(), title: "", notes: "", assets: [], newFiles: [] }])}>+ Add another product / proof item</button> : null}
          </section>

          <section className="proofBuilderSection">
            <div className="proofBuilderHeading"><div><span className="eyebrow">Pricing</span><h5>Order quote</h5></div></div>
            <div className="quoteLineHeader"><span>Description</span><span>Qty</span><span>Unit price</span><span></span></div>
            {lines.map((line, index) => (
              <div className="quoteLine" key={index}>
                <input aria-label={`Line ${index + 1} description`} value={line.description} onChange={(e) => updateLine(index, "description", e.target.value)} disabled={locked} />
                <input aria-label={`Line ${index + 1} quantity`} type="number" min="1" value={line.quantity} onChange={(e) => updateLine(index, "quantity", e.target.value)} disabled={locked} />
                <div className="moneyInput"><span>$</span><input aria-label={`Line ${index + 1} unit price`} type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(index, "unitPrice", e.target.value)} disabled={locked} /></div>
                <button className="quoteRemove" type="button" aria-label="Remove line" disabled={locked || lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>×</button>
              </div>
            ))}
            {!locked ? <button className="textButton" type="button" onClick={() => setLines((current) => [...current, { description: "", quantity: "1", unitPrice: "" }])}>+ Add line item</button> : null}

            <div className="quoteExtras">
              <label>Setup fee <div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={setupFee} onChange={(e) => setSetupFee(e.target.value)} disabled={locked} /></div></label>
              <label>Shipping <div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={shipping} onChange={(e) => setShipping(e.target.value)} disabled={locked} /></div></label>
              <label>Tax <div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} disabled={locked} /></div></label>
              <label>Discount <div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} disabled={locked} /></div></label>
            </div>

            <div className="paymentTermsEditor">
              <div className="proofBuilderHeading"><div><span className="eyebrow">Payment</span><h5>Amount due after approval</h5><p>Full payment is required by default. Switch this order to a custom deposit only when you want to collect part of the total first.</p></div></div>
              <div className="paymentTermsOptions">
                <label className={`paymentTermOption ${paymentTerms === "full" ? "selected" : ""}`}>
                  <input type="radio" name={`paymentTerms-${requestId}`} value="full" checked={paymentTerms === "full"} onChange={() => setPaymentTerms("full")} disabled={locked} />
                  <span><strong>Full payment required</strong><small>{money(total)} due after the customer approves the proof + quote.</small></span>
                </label>
                <label className={`paymentTermOption ${paymentTerms === "deposit" ? "selected" : ""}`}>
                  <input type="radio" name={`paymentTerms-${requestId}`} value="deposit" checked={paymentTerms === "deposit"} onChange={() => setPaymentTerms("deposit")} disabled={locked} />
                  <span><strong>Custom deposit</strong><small>Collect a specific amount now; the remaining balance stays attached to the order.</small></span>
                </label>
              </div>
              {paymentTerms === "deposit" ? <div className="depositAmountRow">
                <label className="field"><span>Deposit due after approval</span><div className="moneyInput"><span>$</span><input type="number" min="0.01" step="0.01" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} disabled={locked} placeholder="100.00" /></div></label>
                <div className="depositSummary"><span>Remaining balance after deposit</span><strong>{money(Math.max(0, total - centsFromInput(depositAmount)))}</strong></div>
              </div> : null}
            </div>

            <div className="quoteMetaGrid">
              <label className="field"><span>Approval valid until</span><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={locked} /></label>
              <label className="field quoteNotes"><span>Quote / production notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Production timing, material notes, special conditions…" disabled={locked} /></label>
            </div>

            <div className="quoteTotals">
              <div><span>Items subtotal</span><strong>{money(subtotal)}</strong></div>
              {centsFromInput(setupFee) ? <div><span>Setup fee</span><strong>{money(centsFromInput(setupFee))}</strong></div> : null}
              {centsFromInput(shipping) ? <div><span>Shipping</span><strong>{money(centsFromInput(shipping))}</strong></div> : null}
              {centsFromInput(tax) ? <div><span>Tax</span><strong>{money(centsFromInput(tax))}</strong></div> : null}
              {centsFromInput(discount) ? <div><span>Discount</span><strong>−{money(centsFromInput(discount))}</strong></div> : null}
              <div className="quoteGrandTotal"><span>Quote total</span><strong>{money(total)}</strong></div>
            </div>
          </section>

          {error ? <div className="formError">{error}</div> : null}
          {message ? <div className="quoteSuccess">{message}</div> : null}
          {!locked ? <div className="quoteActions"><button className="btn secondary" type="button" disabled={saving} onClick={() => submit("save")}>{saving ? "Saving…" : "Save draft"}</button><button className="btn" type="button" disabled={saving} onClick={() => submit("send")}>{saving ? "Working…" : existingQuote?.status === "changes_requested" ? "Send updated proof + quote" : "Send proof + quote for approval"}</button></div> : null}
          {waitingOnCustomer ? <p className="fieldHelp">The customer is reviewing every proof item and the full price together. If they request changes, you&apos;ll be able to create the next proof version here.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
