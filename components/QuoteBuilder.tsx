"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { ApprovalDeliveryControl } from "@/components/ApprovalDeliveryControl";
import { discountAmountCents, normalizeDiscountCode, type DiscountCodeRecord } from "@/lib/discount-types";
import { compactSizeSummary, orderItemQuantity, type ShippingAddress, type StructuredOrderItem } from "@/lib/order-types";
import { recommendedRevenueForMargin, type BusinessSettingsRecord, type ProductPricingRecord } from "@/lib/pricing-types";
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
  discountCodes?: DiscountCodeRecord[];
  requestedDiscountCode?: string | null;
  amountPaidCents?: number;
  orderItems?: StructuredOrderItem[];
  delivery?: string | null;
  shippingAddress?: ShippingAddress | null;
  pricingProfiles?: ProductPricingRecord[];
  businessSettings?: BusinessSettingsRecord | null;
  customerEmail?: string | null;
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

export function QuoteBuilder({ requestId, requestNumber, product, quantity, existingQuote, discountCodes = [], requestedDiscountCode = null, amountPaidCents = 0, orderItems = [], delivery = null, shippingAddress = null, pricingProfiles = [], businessSettings = null, customerEmail = null }: Props) {
  const router = useRouter();
  const minimumLaborHours = Math.max(1, Number(businessSettings?.minimum_labor_hours || 1));
  const pricingBySlug = new Map(pricingProfiles.filter((row) => row.active).map((row) => [row.product_slug, row]));
  const pricedItems = orderItems.filter((item) => orderItemQuantity(item) > 0);
  const pricingDefaults = pricedItems.reduce((acc, item) => {
    const profile = pricingBySlug.get(item.productSlug);
    const qty = orderItemQuantity(item);
    if (!profile || qty <= 0) return acc;
    acc.supply += qty * Number(profile.blank_cost_cents || 0);
    acc.print += qty * Number(profile.print_cost_cents || 0);
    acc.packaging += qty * Number(profile.packaging_cost_cents || 0);
    acc.laborHours += Math.max(minimumLaborHours, Number(profile.default_labor_hours || minimumLaborHours));
    if (acc.targetMargin === null) acc.targetMargin = Number(profile.target_margin_basis_points || 5000);
    return acc;
  }, { supply: 0, print: 0, packaging: 0, laborHours: 0, targetMargin: null as number | null });
  if (pricingDefaults.laborHours <= 0) pricingDefaults.laborHours = minimumLaborHours;
  const defaultLaborRateCents = Math.max(0, Number(businessSettings?.default_labor_rate_cents || 1000));
  const targetMarginBasisPoints = pricingDefaults.targetMargin ?? 5000;
  const itemTaxCodes = Array.from(new Set(pricedItems.map((item) => pricingBySlug.get(item.productSlug)?.tax_code).filter((value): value is string => Boolean(value))));
  const quoteTaxCode = itemTaxCodes.length === 1 ? itemTaxCodes[0] : businessSettings?.default_tax_code || "txcd_99999999";
  const waitingOnCustomer = existingQuote?.status === "sent";
  const approvedQuote = existingQuote?.status === "approved";
  const [revisionMode, setRevisionMode] = useState(false);
  const locked = waitingOnCustomer || (approvedQuote && !revisionMode);
  const [open, setOpen] = useState(Boolean(existingQuote));
  const [lines, setLines] = useState<EditableLine[]>(
    existingQuote?.line_items?.length
      ? existingQuote.line_items.map((item) => ({
          description: item.description,
          quantity: String(item.quantity),
          unitPrice: dollars(item.unitPriceCents),
        }))
      : pricedItems.length
        ? pricedItems.map((item) => ({
            description: `${item.productName}${item.colorName ? ` — ${item.colorName}` : ""}${compactSizeSummary(item) ? ` (${compactSizeSummary(item)})` : ""}`,
            quantity: String(orderItemQuantity(item)),
            unitPrice: "",
          }))
        : [{ description: product, quantity: String(quantity || 1), unitPrice: "" }]
  );
  const [setupFee, setSetupFee] = useState(dollars(existingQuote?.setup_fee_cents));
  const [shipping, setShipping] = useState(dollars(existingQuote?.shipping_cents));
  const [tax, setTax] = useState(dollars(existingQuote?.tax_cents));
  const [taxMode, setTaxMode] = useState<"automatic" | "manual" | "exempt">(existingQuote?.tax_mode || "automatic");
  const [taxCalculationId, setTaxCalculationId] = useState(existingQuote?.stripe_tax_calculation_id || "");
  const [taxCalculatedAt, setTaxCalculatedAt] = useState(existingQuote?.tax_calculated_at || "");
  const [taxInputFingerprint, setTaxInputFingerprint] = useState(existingQuote?.tax_input_fingerprint || "");
  const [taxExemptReason, setTaxExemptReason] = useState(existingQuote?.tax_exempt_reason || "");
  const [taxBreakdown, setTaxBreakdown] = useState<Record<string, unknown> | null>(existingQuote?.tax_breakdown || null);
  const [taxLocation, setTaxLocation] = useState<string>("");
  const [calculatingTax, setCalculatingTax] = useState(false);
  const [manualDiscount, setManualDiscount] = useState(dollars(existingQuote?.manual_discount_cents ?? existingQuote?.discount_cents));
  const [discountCode, setDiscountCode] = useState(existingQuote?.applied_discount_code || requestedDiscountCode || "");
  const [supplyCost, setSupplyCost] = useState(existingQuote ? dollars(existingQuote.internal_supply_cost_cents) : dollars(pricingDefaults.supply));
  const [printCost, setPrintCost] = useState(existingQuote ? dollars(existingQuote.internal_print_cost_cents) : dollars(pricingDefaults.print));
  const [packagingCost, setPackagingCost] = useState(existingQuote ? dollars(existingQuote.internal_packaging_cost_cents) : dollars(pricingDefaults.packaging));
  const [shippingCost, setShippingCost] = useState(dollars(existingQuote?.internal_shipping_cost_cents));
  const [paymentFee, setPaymentFee] = useState(dollars(existingQuote?.internal_payment_fee_cents));
  const [otherCost, setOtherCost] = useState(dollars(existingQuote?.internal_other_cost_cents));
  const [laborHours, setLaborHours] = useState(existingQuote?.labor_hours && existingQuote.labor_hours > 0 ? String(existingQuote.labor_hours) : String(pricingDefaults.laborHours));
  const [laborRate, setLaborRate] = useState(existingQuote?.labor_rate_cents ? (existingQuote.labor_rate_cents / 100).toFixed(2) : (defaultLaborRateCents / 100).toFixed(2));
  const [revisionReason, setRevisionReason] = useState("");
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
  const [importingMockups, setImportingMockups] = useState(false);
  const [mockupImportChecked, setMockupImportChecked] = useState(Boolean(existingQuote));
  const [hasSavedMockup, setHasSavedMockup] = useState(Boolean(existingQuote?.mockup_snapshot));
  const [useSavedMockup, setUseSavedMockup] = useState(Boolean(existingQuote?.mockup_snapshot) || !existingQuote);

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
  const eligibleDiscountSubtotal = subtotal + centsFromInput(setupFee);
  const normalizedDiscountCode = normalizeDiscountCode(discountCode);
  const selectedDiscountCode = discountCodes.find((code) => normalizeDiscountCode(code.code) === normalizedDiscountCode) || null;
  const promoDiscount = selectedDiscountCode ? discountAmountCents(selectedDiscountCode, eligibleDiscountSubtotal) : 0;
  const totalDiscount = Math.min(eligibleDiscountSubtotal, centsFromInput(manualDiscount) + promoDiscount);
  const merchandiseAfterDiscountCents = Math.max(0, subtotal + centsFromInput(setupFee) - totalDiscount);
  const currentTaxInputFingerprint = JSON.stringify({
    merchandiseAfterDiscountCents,
    shippingCents: centsFromInput(shipping),
    delivery: delivery || "",
    shippingAddress: shippingAddress || null,
  });
  const automaticTaxFresh = taxMode === "automatic" && Boolean(taxCalculationId) && taxInputFingerprint === currentTaxInputFingerprint;
  const effectiveTaxCents = taxMode === "exempt" ? 0 : centsFromInput(tax);
  const total = Math.max(0, subtotal + centsFromInput(setupFee) + centsFromInput(shipping) + effectiveTaxCents - totalDiscount);
  const safeLaborHours = Math.max(minimumLaborHours, Number(laborHours) || minimumLaborHours);
  const laborCost = Math.round(safeLaborHours * centsFromInput(laborRate));
  const internalTotalCost = centsFromInput(supplyCost) + centsFromInput(printCost) + centsFromInput(packagingCost) + centsFromInput(shippingCost) + centsFromInput(paymentFee) + centsFromInput(otherCost) + laborCost;
  const revenueBeforeTax = Math.max(0, subtotal + centsFromInput(setupFee) + centsFromInput(shipping) - totalDiscount);
  const estimatedProfit = revenueBeforeTax - internalTotalCost;
  const marginPercent = revenueBeforeTax > 0 ? (estimatedProfit / revenueBeforeTax) * 100 : 0;
  const recommendedRevenue = recommendedRevenueForMargin(internalTotalCost, targetMarginBasisPoints);
  const remainingAfterPayments = Math.max(0, total - amountPaidCents);
  const overpaidCents = Math.max(0, amountPaidCents - total);

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

  async function importMockupStudio(silent = false) {
    if (locked) return;
    setImportingMockups(true);
    if (!silent) { setError(""); setMessage(""); }
    try {
      const response = await fetch(`/api/admin/mockups?requestId=${encodeURIComponent(requestId)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) {
        if (silent && (response.status === 503 || response.status === 404)) return;
        throw new Error(result.error || "Could not load Mockup Studio exports.");
      }
      const hasDocument = Boolean(result?.document?.views?.some((view: { customerIntent?: { enabled?: boolean }; layers?: unknown[]; base?: unknown; exportAsset?: unknown }) => view?.customerIntent?.enabled || (Array.isArray(view?.layers) && view.layers.length) || view?.base || view?.exportAsset));
      setHasSavedMockup(hasDocument);
      if (hasDocument && !existingQuote) setUseSavedMockup(true);
      const exports = Array.isArray(result.proofExports) ? result.proofExports : [];
      if (!exports.length) {
        if (!silent) setMessage(hasDocument ? "The saved customer/admin mockup is ready to attach directly to the quote. Exported PNG proof files are optional." : "No saved mockup or exported proof views are ready yet.");
        return;
      }
      const assets: QuoteProofAsset[] = exports.map((item: { path: string; originalName?: string; url?: string }) => ({ path: item.path, originalName: item.originalName || item.path.split("/").pop() || "Mockup", url: item.url }));
      setProofItems((current) => {
        const existingPaths = new Set(current.flatMap((item) => item.assets.map((asset) => asset.path)));
        const newAssets = assets.filter((asset) => !existingPaths.has(asset.path));
        if (!newAssets.length) return current;
        const emptyIndex = current.findIndex((item) => item.assets.length === 0 && item.newFiles.length === 0 && !item.dbId);
        if (emptyIndex >= 0) return current.map((item, index) => index === emptyIndex ? { ...item, title: item.title.trim() || product || "Order mockup", assets: newAssets } : item);
        return [...current, { clientKey: newClientKey(), title: product || "Order mockup", notes: "Created in Moore Made Mockup Studio.", assets: newAssets, newFiles: [] }];
      });
      if (!silent) setMessage(`${exports.length} Mockup Studio view${exports.length === 1 ? "" : "s"} added to this proof.`);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Could not import Mockup Studio exports.");
    } finally {
      setImportingMockups(false);
      setMockupImportChecked(true);
    }
  }

  useEffect(() => {
    if (existingQuote || locked || mockupImportChecked) return;
    void importMockupStudio(true);
    // Intentional one-time import check for a brand-new quote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingQuote, locked, mockupImportChecked]);

  useEffect(() => {
    if (locked) return;
    const handleExport = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string }>).detail;
      if (detail?.requestId === requestId) void importMockupStudio(true);
    };
    window.addEventListener("moore-made-mockup-exported", handleExport);
    return () => window.removeEventListener("moore-made-mockup-exported", handleExport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, locked]);

  async function calculateAutomaticTax() {
    setError("");
    setMessage("");
    setCalculatingTax(true);
    try {
      const response = await fetch("/api/admin/tax/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          merchandiseCents: merchandiseAfterDiscountCents,
          shippingCents: centsFromInput(shipping),
          inputFingerprint: currentTaxInputFingerprint,
          taxCode: quoteTaxCode,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not calculate sales tax.");
      setTax((Math.max(0, Number(result.taxCents || 0)) / 100).toFixed(2));
      setTaxCalculationId(String(result.calculationId || ""));
      setTaxCalculatedAt(String(result.calculatedAt || new Date().toISOString()));
      setTaxInputFingerprint(String(result.inputFingerprint || currentTaxInputFingerprint));
      setTaxBreakdown(result.breakdown && typeof result.breakdown === "object" ? result.breakdown : null);
      const location = result.location;
      setTaxLocation(location ? `${location.city}, ${location.state} ${location.postalCode}` : "");
      setMessage(`Automatic sales tax calculated${location ? ` for ${location.city}, ${location.state}` : ""}.`);
    } catch (taxError) {
      setError(taxError instanceof Error ? taxError.message : "Could not calculate sales tax.");
    } finally {
      setCalculatingTax(false);
    }
  }

  async function submit(action: "save" | "send") {
    setError("");
    setMessage("");

    if (waitingOnCustomer) {
      setError("This proof + quote is already with the customer. Wait for approval or a change request before editing it.");
      return;
    }
    if (approvedQuote && revisionMode && action === "save") {
      setError("Approved quotes stay intact until the revision is sent. Use Send revised quote when the changes are ready.");
      return;
    }
    if (approvedQuote && revisionMode && revisionReason.trim().length < 3) {
      setError("Add a short reason for this quote revision so the change history is clear.");
      return;
    }
    if (Number(laborHours) < minimumLaborHours) {
      setError(`Labor has a ${minimumLaborHours}-hour minimum. Increase the estimate if this job will take longer.`);
      return;
    }
    if (action === "send" && taxMode === "automatic" && !automaticTaxFresh) {
      setError("The automatic tax calculation is missing or out of date. Recalculate tax after the latest price/shipping changes.");
      return;
    }
    if (taxMode === "exempt" && taxExemptReason.trim().length < 3) {
      setError("Add a reason or exemption-document note for a tax-exempt quote.");
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
      const savedMockupWillBeAttached = hasSavedMockup && useSavedMockup;
      if (action === "send" && !savedMockupWillBeAttached && !proofPayload.some((item) => item.assets.length > 0)) {
        throw new Error("Attach the saved customer mockup or upload at least one final proof before sending this approval.");
      }
      if (action === "send") {
        const missingAdditionalProof = proofPayload.find((item, index) => item.assets.length === 0 && !(index === 0 && savedMockupWillBeAttached));
        if (missingAdditionalProof) {
          throw new Error(`Add a proof file for ${missingAdditionalProof.title}. The first proof item may use the saved customer mockup.`);
        }
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
          taxCents: taxMode === "automatic" && !automaticTaxFresh ? 0 : effectiveTaxCents,
          taxMode,
          stripeTaxCalculationId: taxMode === "automatic" && automaticTaxFresh ? taxCalculationId : null,
          taxCalculatedAt: taxMode === "automatic" && automaticTaxFresh ? taxCalculatedAt : null,
          taxInputFingerprint: taxMode === "automatic" && automaticTaxFresh ? taxInputFingerprint : null,
          taxBreakdown: taxMode === "automatic" && automaticTaxFresh ? taxBreakdown : null,
          taxExemptReason: taxMode === "exempt" ? taxExemptReason.trim() : null,
          manualDiscountCents: centsFromInput(manualDiscount),
          discountCode: normalizedDiscountCode,
          internalSupplyCostCents: centsFromInput(supplyCost),
          internalPrintCostCents: centsFromInput(printCost),
          internalPackagingCostCents: centsFromInput(packagingCost),
          internalShippingCostCents: centsFromInput(shippingCost),
          internalPaymentFeeCents: centsFromInput(paymentFee),
          internalOtherCostCents: centsFromInput(otherCost),
          laborHours: safeLaborHours,
          laborRateCents: centsFromInput(laborRate),
          revisionReason: approvedQuote && revisionMode ? revisionReason.trim() : "",
          paymentTerms,
          depositAmountCents: paymentTerms === "deposit" ? centsFromInput(depositAmount) : null,
          notes,
          proofItems: proofPayload,
          includeSavedMockup: savedMockupWillBeAttached,
          validUntil,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save proof and quote.");
      setProofItems((current) => current.map((item) => ({ ...item, newFiles: [] })));
      setMessage(result.message || (action === "send" ? "Proof and quote sent." : "Draft saved."));
      if (approvedQuote && revisionMode && action === "send") setRevisionMode(false);
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
          {existingQuote?.status === "approved" && !revisionMode ? <div className="quoteLocked quoteRevisionLocked"><span>This proof and quote have been approved. The approved version stays protected.</span><button className="btn secondary" type="button" onClick={() => { setRevisionMode(true); setRevisionReason(""); }}>Revise quote</button></div> : null}
          {existingQuote?.status === "approved" && revisionMode ? <div className="quoteRevisionMode"><div><strong>Creating quote revision {Number(existingQuote.revision_number || 1) + 1}</strong><span>The current approved quote will not change until you send this revision. Sending it will require the customer to approve the new total/details again.</span></div><button className="textButton" type="button" onClick={() => window.location.reload()}>Cancel revision</button></div> : null}
          {waitingOnCustomer ? <div className="quoteWaitingNotice"><strong>Sent to the customer for review</strong><span>The quote is protected while they review it. You can resend the approval email or copy the approval link below without changing anything.</span></div> : null}
          {existingQuote?.public_token ? <div className="quoteDocumentActions"><a className="btn secondary" href={`/proforma/${existingQuote.public_token}`} target="_blank" rel="noreferrer">Open Pro Forma + Proof ↗</a>{existingQuote.status === "approved" ? <a className="btn secondary" href={`/invoice/${existingQuote.public_token}`} target="_blank" rel="noreferrer">Open Invoice ↗</a> : null}</div> : null}
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
              <div><span className="eyebrow">Product proofs</span><h5>Use the customer mockup, refine it, then quote it</h5><p>The saved Shop mockup can be attached directly to the approval. You can still edit it in Mockup Studio or add separate proof files for additional products/designs.</p></div>
              <div className="proofBuilderHeaderActions"><button className="btn secondary" type="button" disabled={locked || importingMockups} onClick={() => importMockupStudio(false)}>{importingMockups ? "Checking…" : "Check saved mockup"}</button><span className="proofVersionBadge">Version {displayVersion}</span></div>
            </div>

            {hasSavedMockup ? <label className={`savedMockupQuoteOption ${useSavedMockup ? "selected" : ""}`}>
              <input type="checkbox" checked={useSavedMockup} onChange={(event) => setUseSavedMockup(event.target.checked)} disabled={locked} />
              <span><strong>Attach the current saved mockup to this quote</strong><small>Recommended. Moore Made freezes a copy when the quote is sent, so later edits cannot change what the customer approved.</small></span>
            </label> : <div className="savedMockupQuoteOption unavailable"><span><strong>No saved Shop/Mockup Studio preview found yet</strong><small>Open Mockup Studio above or add a proof image/PDF below.</small></span></div>}

            <div className="proofItemEditorList">
              {proofItems.map((item, index) => {
                const totalFiles = item.assets.length + item.newFiles.length;
                return (
                  <details className="proofItemEditor" key={item.clientKey}>
                    <summary>
                      <div><span className="proofItemNumber">{String(index + 1).padStart(2, "0")}</span><strong>{item.title.trim() || "Untitled proof item"}</strong></div>
                      <span>{totalFiles ? `${totalFiles} file${totalFiles === 1 ? "" : "s"}` : index === 0 && hasSavedMockup && useSavedMockup ? "Saved mockup attached" : "No file yet"}</span>
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
                        <span className="fieldHelp">Optional for the first item when the saved mockup is attached. Add images/PDFs for alternate views or additional products/designs.</span>
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
              <label>Shipping charged <div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={shipping} onChange={(e) => setShipping(e.target.value)} disabled={locked} /></div></label>
              <label>Manual discount <div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={manualDiscount} onChange={(e) => setManualDiscount(e.target.value)} disabled={locked} /></div></label>
            </div>

            <div className="quoteTaxPanel">
              <div className="proofBuilderHeading"><div><span className="eyebrow">Sales tax</span><h5>How should tax be handled?</h5><p>Automatic uses the order's shipping address or your saved pickup/business address. Manual and tax-exempt modes stay available for unusual orders.</p></div></div>
              <div className="taxModeOptions">
                {([
                  ["automatic", "Automatic", "Calculate with Stripe Tax"],
                  ["manual", "Manual", "Enter the tax amount yourself"],
                  ["exempt", "Tax exempt", "No tax; keep an internal reason/document note"],
                ] as const).map(([value, label, help]) => (
                  <label className={`taxModeOption ${taxMode === value ? "selected" : ""}`} key={value}>
                    <input type="radio" name={`tax-mode-${requestId}`} value={value} checked={taxMode === value} disabled={locked} onChange={() => { setTaxMode(value); if (value === "exempt") setTax("0.00"); }} />
                    <span><strong>{label}</strong><small>{help}</small></span>
                  </label>
                ))}
              </div>
              {taxMode === "automatic" ? (
                <div className="automaticTaxBox">
                  <div><span>Calculated tax</span><strong>{money(effectiveTaxCents)}</strong><small>{automaticTaxFresh ? `Current${taxLocation ? ` · ${taxLocation}` : ""}${taxCalculatedAt ? ` · ${new Date(taxCalculatedAt).toLocaleString("en-US", { timeZone: "America/New_York" })}` : ""}` : taxCalculationId ? "Price/address changed — recalculate before sending." : "Not calculated yet."}</small></div>
                  <button className="btn secondary" type="button" disabled={locked || calculatingTax} onClick={calculateAutomaticTax}>{calculatingTax ? "Calculating…" : automaticTaxFresh ? "Recalculate tax" : "Calculate tax"}</button>
                  <p className="fieldHelp">If Stripe Tax returns $0, verify your Stripe Tax registrations before assuming the sale is tax-free.</p>
                </div>
              ) : taxMode === "manual" ? (
                <label className="field taxManualField"><span>Sales tax amount</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} disabled={locked} /></div></label>
              ) : (
                <label className="field taxExemptField"><span>Tax-exempt reason / documentation note *</span><input value={taxExemptReason} onChange={(e) => setTaxExemptReason(e.target.value)} disabled={locked} maxLength={1000} placeholder="Example: Resale certificate on file — customer certificate dated …" /></label>
              )}
            </div>

            <div className="quoteDiscountEditor">
              <div className="proofBuilderHeading"><div><span className="eyebrow">Discounts</span><h5>Promo / family pricing</h5><p>Use a managed discount code or a manual discount. They can be combined; the customer sees only the final discount and total.</p></div></div>
              <div className="twoCol">
                <label className="field"><span>Discount code <small>Optional</small></span><input value={discountCode} onChange={(e) => setDiscountCode(e.target.value.toUpperCase())} list={`discount-codes-${requestId}`} placeholder="FAMILY10" disabled={locked} /><datalist id={`discount-codes-${requestId}`}>{discountCodes.filter((code) => code.active && !code.retired_at).map((code) => <option value={code.code} key={code.id}>{code.description || code.code}</option>)}</datalist>{requestedDiscountCode && !existingQuote?.applied_discount_code ? <small className="fieldHelp">Customer entered: <strong>{requestedDiscountCode}</strong></small> : null}</label>
                <div className="quoteDiscountPreview"><span>Promo discount</span><strong>{selectedDiscountCode ? `−${money(promoDiscount)}` : normalizedDiscountCode ? "Validated when saved" : money(0)}</strong><small>{selectedDiscountCode?.description || (normalizedDiscountCode ? "The server will verify status, dates, limits, and minimum order." : "No promo code applied")}</small></div>
              </div>
            </div>

            <div className="internalCostPanel">
              <div className="proofBuilderHeading"><div><span className="eyebrow">Admin only</span><h5>True job cost</h5><p>This breakdown never appears on the customer quote. Labor uses your admin minimum and can be increased for larger or multi-part jobs. Saved product defaults prefill this section when available.</p></div></div>
              <div className="internalCostGrid">
                <label>Blanks / product supplies <div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={supplyCost} onChange={(e) => setSupplyCost(e.target.value)} disabled={locked} /></div></label>
                <label>Print / decoration <div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={printCost} onChange={(e) => setPrintCost(e.target.value)} disabled={locked} /></div></label>
                <label>Packaging / supplies <div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={packagingCost} onChange={(e) => setPackagingCost(e.target.value)} disabled={locked} /></div></label>
                <label>Actual shipping cost <div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} disabled={locked} /></div></label>
                <label>Payment fee estimate <div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={paymentFee} onChange={(e) => setPaymentFee(e.target.value)} disabled={locked} /></div></label>
                <label>Other cost <div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={otherCost} onChange={(e) => setOtherCost(e.target.value)} disabled={locked} /></div></label>
              </div>
              <div className="laborCostEditor">
                <label className="field"><span>Estimated labor hours</span><input type="number" min={minimumLaborHours} step="0.5" value={laborHours} onChange={(e) => setLaborHours(e.target.value)} disabled={locked} /></label>
                <label className="field"><span>Internal labor rate / hour</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.25" value={laborRate} onChange={(e) => setLaborRate(e.target.value)} disabled={locked} /></div></label>
                <div className="laborCostResult"><span>Labor cost</span><strong>{money(laborCost)}</strong><small>{safeLaborHours.toLocaleString()} hr × {money(centsFromInput(laborRate))}/hr</small></div>
              </div>
              <p className="fieldHelp">If the customer supplies the blanks, set “Blanks / product supplies” to $0. These are internal costing numbers, not customer-facing line items.</p>
              <div className="profitabilityCard">
                <div><span>True estimated job cost</span><strong>{money(internalTotalCost)}</strong></div>
                <div><span>Revenue before sales tax</span><strong>{money(revenueBeforeTax)}</strong></div>
                <div className={estimatedProfit < 0 ? "profitLoss" : "profitPositive"}><span>Estimated profit</span><strong>{money(estimatedProfit)}</strong></div>
                <div><span>Estimated margin</span><strong>{marginPercent.toFixed(1)}%</strong></div>
                <div className="profitRecommendation"><span>Recommended revenue at {(targetMarginBasisPoints / 100).toFixed(0)}% target margin</span><strong>{money(recommendedRevenue)}</strong><small>Suggestion only — you choose the final customer quote.</small></div>
              </div>
            </div>

            {approvedQuote && revisionMode ? <div className="quoteRevisionReason"><label className="field"><span>Reason for revision *</span><input value={revisionReason} onChange={(e) => setRevisionReason(e.target.value)} maxLength={500} placeholder="Example: Quantity increased from 4 shirts to 7." /></label></div> : null}

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
              {effectiveTaxCents ? <div><span>Tax</span><strong>{money(effectiveTaxCents)}</strong></div> : taxMode === "exempt" ? <div><span>Tax</span><strong>Exempt</strong></div> : null}
              {centsFromInput(manualDiscount) ? <div><span>Manual discount</span><strong>−{money(centsFromInput(manualDiscount))}</strong></div> : null}
              {promoDiscount ? <div><span>Promo {normalizedDiscountCode ? `(${normalizedDiscountCode})` : ""}</span><strong>−{money(promoDiscount)}</strong></div> : null}
              <div className="quoteGrandTotal"><span>Customer total</span><strong>{money(total)}</strong></div>
              {amountPaidCents > 0 ? <><div><span>Already paid</span><strong>{money(amountPaidCents)}</strong></div><div><span>Remaining after approval</span><strong>{money(remainingAfterPayments)}</strong></div>{overpaidCents > 0 ? <div className="quoteCreditWarning"><span>Credit / refund review</span><strong>{money(overpaidCents)}</strong></div> : null}</> : null}
            </div>
          </section>

          {existingQuote?.revisions?.length ? <section className="quoteRevisionHistory"><div className="proofBuilderHeading"><div><span className="eyebrow">History</span><h5>Quote revisions</h5><p>Earlier sent/approved totals stay in the record instead of being overwritten.</p></div></div><div className="quoteRevisionList">{existingQuote.revisions.map((revision) => <div key={revision.id}><span>Revision {revision.revision_number}</span><strong>{money(revision.total_cents)}</strong><small>{QUOTE_STATUS_LABELS[revision.status]}{revision.revision_reason ? ` · ${revision.revision_reason}` : ""}</small></div>)}</div></section> : null}

          {error ? <div className="formError">{error}</div> : null}
          {message ? <div className="quoteSuccess">{message}</div> : null}
          {!locked ? <div className="quoteActions">{!(approvedQuote && revisionMode) ? <button className="btn secondary" type="button" disabled={saving} onClick={() => submit("save")}>{saving ? "Saving…" : "Save draft"}</button> : null}<button className="btn" type="button" disabled={saving} onClick={() => submit("send")}>{saving ? "Working…" : approvedQuote && revisionMode ? "Send revised quote for approval" : existingQuote?.status === "changes_requested" ? "Send updated proof + quote" : "Send proof + quote for approval"}</button></div> : null}
          {waitingOnCustomer ? <ApprovalDeliveryControl requestId={requestId} customerEmail={customerEmail} /> : null}
        </div>
      ) : null}
    </div>
  );
}
