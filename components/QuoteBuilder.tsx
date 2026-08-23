"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { ApprovalDeliveryControl } from "@/components/ApprovalDeliveryControl";
import { discountAmountCents, normalizeDiscountCode, type DiscountCodeRecord } from "@/lib/discount-types";
import { orderItemQuantity, type ShippingAddress, type StructuredOrderItem } from "@/lib/order-types";
import { estimatedPaymentFeeCents, priceForSize, recommendedRevenueWithSafeguards, standardShirtMinProfitForQuantity, suggestedLaborHoursForQuantity, targetMarginForQuantity, type BusinessSettingsRecord, type ProductPricingRecord } from "@/lib/pricing-types";
import { starterPricingFor } from "@/lib/pricing-suggestions";
import { missingPreviewArtworkViews } from "@/lib/mockup-variants";
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
  printSides?: string | null;
  customerIdeas?: string[];
  delivery?: string | null;
  shippingAddress?: ShippingAddress | null;
  pricingProfiles?: ProductPricingRecord[];
  businessSettings?: BusinessSettingsRecord | null;
  customerEmail?: string | null;
  reorderPriceLock?: Record<string, unknown> | null;
};

type EditableLine = { description: string; quantity: string; unitPrice: string };
type SupplierCostRow = { key: string; productName: string; colorName: string; size: string; quantity: number; unitCost: string };
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

function decorationLocationCount(value?: string | null, productName?: string) {
  const full = String(value || "");
  const matchingSegment = productName
    ? full.split("·").find((segment) => segment.toLowerCase().includes(productName.toLowerCase()))
    : "";
  const normalized = String(matchingSegment || full).toLowerCase();
  const explicit = ["front", "back", "left sleeve", "right sleeve", "sleeve", "side 1", "side 2"]
    .filter((label, index, values) => normalized.includes(label) && values.indexOf(label) === index).length;
  if (normalized.includes("front") && normalized.includes("back")) return Math.max(2, explicit);
  return Math.max(1, explicit);
}

function isStandardShirt(productName: string, productSlug: string) {
  return /(shirt|tee|crewneck|sweatshirt)/i.test(`${productName} ${productSlug}`);
}

function lockedNumber(lock: Record<string, unknown> | null | undefined, key: string) {
  const value = Number(lock?.[key]);
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function QuoteBuilder({ requestId, requestNumber, product, quantity, existingQuote, discountCodes = [], requestedDiscountCode = null, amountPaidCents = 0, orderItems = [], printSides = null, customerIdeas = [], delivery = null, shippingAddress = null, pricingProfiles = [], businessSettings = null, customerEmail = null, reorderPriceLock = null }: Props) {
  const router = useRouter();
  const normalizedDelivery = String(delivery || "").trim().toLowerCase();
  const fulfillmentMode = normalizedDelivery.includes("ship") ? "shipping" : normalizedDelivery.includes("delivery") ? "delivery" : normalizedDelivery.includes("pickup") ? "pickup" : "";
  const hasFulfillmentMethod = Boolean(fulfillmentMode);
  const destinationAddressComplete = Boolean(shippingAddress?.line1?.trim() && shippingAddress?.city?.trim() && shippingAddress?.state?.trim() && shippingAddress?.postalCode?.trim() && shippingAddress?.country?.trim());
  const fulfillmentAddressReady = fulfillmentMode === "pickup" || ((fulfillmentMode === "shipping" || fulfillmentMode === "delivery") && destinationAddressComplete);
  const automaticTaxPrerequisitesMet = hasFulfillmentMethod && fulfillmentAddressReady;
  const fulfillmentMethodLabel = fulfillmentMode === "shipping" ? "Shipping" : fulfillmentMode === "delivery" ? "Local delivery" : fulfillmentMode === "pickup" ? "Local pickup" : "Not chosen";
  const fulfillmentChargeLabel = fulfillmentMode === "delivery" ? "Local delivery" : fulfillmentMode === "shipping" ? "Shipping" : "Fulfillment";
  const minimumLaborHours = Math.max(1, Number(businessSettings?.minimum_labor_hours || 1));
  const pricingBySlug = new Map(pricingProfiles.filter((row) => row.active).map((row) => [row.product_slug, row]));
  const pricedItems = orderItems.filter((item) => orderItemQuantity(item) > 0);
  const totalOrderQuantity = Math.max(1, pricedItems.reduce((sum, item) => sum + orderItemQuantity(item), 0) || quantity || 1);
  const suggestedLaborHours = suggestedLaborHoursForQuantity(totalOrderQuantity, minimumLaborHours);
  const locationCount = decorationLocationCount(printSides);
  const pricingDefaults = pricedItems.reduce((acc, item) => {
    const savedProfile = pricingBySlug.get(item.productSlug);
    const starter = starterPricingFor(item.productSlug);
    const qty = orderItemQuantity(item);
    const itemLocationCount = decorationLocationCount(printSides, item.productName);
    if (qty <= 0) return acc;
    for (const [size, rawQuantity] of Object.entries(item.quantities || {})) {
      const sizeQuantity = Math.max(0, Math.floor(Number(rawQuantity) || 0));
      acc.supply += sizeQuantity * priceForSize(size, Number(savedProfile?.blank_cost_cents ?? starter.blankCostCents), savedProfile?.size_blank_costs || starter.sizeBlankCostsCents);
    }
    const basePrintCost = Number(savedProfile?.print_cost_cents ?? starter.printCostCents);
    const additionalLocationCost = Number(savedProfile?.additional_location_cost_cents ?? starter.additionalLocationCostCents ?? basePrintCost);
    acc.print += qty * (basePrintCost + Math.max(0, itemLocationCount - 1) * additionalLocationCost);
    acc.packaging += qty * Number(savedProfile?.packaging_cost_cents ?? starter.packagingCostCents);
    const minimumProfit = isStandardShirt(item.productName, item.productSlug)
      ? standardShirtMinProfitForQuantity(totalOrderQuantity, businessSettings)
      : Number(savedProfile?.minimum_profit_per_item_cents ?? starter.minimumProfitPerItemCents ?? 0);
    acc.minimumProfit += qty * Math.max(0, minimumProfit);
    return acc;
  }, { supply: 0, print: 0, packaging: 0, minimumProfit: 0 });
  const defaultLaborRateCents = Math.max(0, Number(businessSettings?.default_labor_rate_cents || 2500));
  const quantityTargetMarginBasisPoints = targetMarginForQuantity(totalOrderQuantity, businessSettings);
  const itemTaxCodes = Array.from(new Set(pricedItems.map((item) => pricingBySlug.get(item.productSlug)?.tax_code).filter((value): value is string => Boolean(value))));
  const quoteTaxCode = itemTaxCodes.length === 1 ? itemTaxCodes[0] : businessSettings?.default_tax_code || "txcd_99999999";
  const defaultCustomerLines = pricedItems.flatMap((item) => {
    const savedProfile = pricingBySlug.get(item.productSlug);
    const starter = starterPricingFor(item.productSlug);
    const itemLocationCount = decorationLocationCount(printSides, item.productName);
    const groups = new Map<number, Array<{ size: string; quantity: number }>>();
    for (const [size, rawQuantity] of Object.entries(item.quantities || {})) {
      const sizeQuantity = Math.max(0, Math.floor(Number(rawQuantity) || 0));
      if (!sizeQuantity) continue;
      const blankCost = priceForSize(size, Number(savedProfile?.blank_cost_cents ?? starter.blankCostCents), savedProfile?.size_blank_costs || starter.sizeBlankCostsCents);
      const basePrintCost = Number(savedProfile?.print_cost_cents ?? starter.printCostCents);
      const additionalLocationCost = Number(savedProfile?.additional_location_cost_cents ?? starter.additionalLocationCostCents ?? basePrintCost);
      const directUnitCost = blankCost + basePrintCost + Math.max(0, itemLocationCount - 1) * additionalLocationCost + Number(savedProfile?.packaging_cost_cents ?? starter.packagingCostCents);
      const allocatedLabor = Math.ceil((suggestedLaborHours * defaultLaborRateCents) / totalOrderQuantity);
      const minimumProfit = isStandardShirt(item.productName, item.productSlug)
        ? standardShirtMinProfitForQuantity(totalOrderQuantity, businessSettings)
        : Number(savedProfile?.minimum_profit_per_item_cents ?? starter.minimumProfitPerItemCents ?? 0);
      const surcharge = Math.max(0, Number(savedProfile?.size_customer_surcharges?.[size] ?? starter.sizeCustomerSurchargesCents[size] ?? 0));
      const recommendedForSize = recommendedRevenueWithSafeguards({
        baseCostCents: (directUnitCost + allocatedLabor) * sizeQuantity,
        quantity: sizeQuantity,
        targetMarginBasisPoints: quantityTargetMarginBasisPoints,
        minimumProfitPerItemCents: minimumProfit,
        settings: businessSettings,
      });
      const unitPriceCents = Math.ceil(recommendedForSize / sizeQuantity) + surcharge;
      groups.set(unitPriceCents, [...(groups.get(unitPriceCents) || []), { size, quantity: sizeQuantity }]);
    }
    return Array.from(groups.entries()).map(([unitPriceCents, sizes]) => ({
      description: `${item.productName}${item.colorName ? ` — ${item.colorName}` : ""} (${sizes.map((row) => `${row.size} × ${row.quantity}`).join(", ")})`,
      quantity: String(sizes.reduce((sum, row) => sum + row.quantity, 0)),
      unitPrice: unitPriceCents ? (unitPriceCents / 100).toFixed(2) : "",
    }));
  });
  const supplierProductRows: SupplierCostRow[] = pricedItems.flatMap((item) => {
    const savedProfile = pricingBySlug.get(item.productSlug);
    const starter = starterPricingFor(item.productSlug);
    return Object.entries(item.quantities || {}).flatMap(([size, rawQuantity]) => {
      const sizeQuantity = Math.max(0, Math.floor(Number(rawQuantity) || 0));
      if (!sizeQuantity) return [];
      const previous = existingQuote?.internal_supplier_costs?.find((row) => row.key === `${item.id}:${size}`);
      const unitCostCents = previous?.unitCostCents ?? priceForSize(size, Number(savedProfile?.blank_cost_cents ?? starter.blankCostCents), savedProfile?.size_blank_costs || starter.sizeBlankCostsCents);
      return [{ key: `${item.id}:${size}`, productName: item.productName, colorName: item.colorName || "", size, quantity: sizeQuantity, unitCost: (unitCostCents / 100).toFixed(2) }];
    });
  });
  const savedSupplierShipping = existingQuote?.internal_supplier_costs?.find((row) => row.key === "__supplier_shipping__");
  const savedSupplierTax = existingQuote?.internal_supplier_costs?.find((row) => row.key === "__supplier_tax__");
  const defaultSupplierRows: SupplierCostRow[] = supplierProductRows.length ? [
    ...supplierProductRows,
    { key: "__supplier_shipping__", productName: "Jiffy / supplier checkout", colorName: "Inbound shipping charged by the supplier", size: "Shipping", quantity: 1, unitCost: ((savedSupplierShipping?.unitCostCents ?? existingQuote?.internal_supplier_shipping_cents ?? 0) / 100).toFixed(2) },
    { key: "__supplier_tax__", productName: "Jiffy / supplier checkout", colorName: "Enter $0 after Jiffy approves Moore Made's resale exemption", size: "Supplier tax", quantity: 1, unitCost: ((savedSupplierTax?.unitCostCents ?? existingQuote?.internal_supplier_tax_cents ?? 0) / 100).toFixed(2) },
  ] : [];
  const waitingOnCustomer = existingQuote?.status === "sent";
  const approvedQuote = existingQuote?.status === "approved";
  const lockedSnapshotLines: QuoteLineItem[] = Array.isArray(reorderPriceLock?.lineItems)
    ? reorderPriceLock.lineItems.map((item) => ({
        description: String((item as QuoteLineItem)?.description || ""),
        quantity: Math.max(1, Math.floor(Number((item as QuoteLineItem)?.quantity) || 1)),
        unitPriceCents: Math.max(0, Math.round(Number((item as QuoteLineItem)?.unitPriceCents) || 0)),
      })).filter((item) => item.description && item.unitPriceCents > 0)
    : [];
  const isReorderPriceLocked = Boolean(reorderPriceLock && lockedSnapshotLines.length);
  const originalFulfillment = String(reorderPriceLock?.delivery || "").trim().toLowerCase();
  const fulfillmentChangedOnReorder = isReorderPriceLocked && originalFulfillment !== normalizedDelivery;
  const shippingPriceLocked = isReorderPriceLocked && !fulfillmentChangedOnReorder;
  const defaultShippingChargeCents = fulfillmentMode === "shipping" ? Math.max(0, Number(businessSettings?.default_shipping_charge_cents ?? 0)) : 0;
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
      : lockedSnapshotLines.length
        ? lockedSnapshotLines.map((item) => ({ description: item.description, quantity: String(item.quantity), unitPrice: dollars(item.unitPriceCents) }))
      : defaultCustomerLines.length
        ? defaultCustomerLines
        : [{ description: product, quantity: String(quantity || 1), unitPrice: "" }]
  );
  const [setupFee, setSetupFee] = useState(dollars(existingQuote?.setup_fee_cents ?? (isReorderPriceLocked ? lockedNumber(reorderPriceLock, "setupFeeCents") : 0)));
  const [shipping, setShipping] = useState(dollars(existingQuote?.shipping_cents ?? (shippingPriceLocked ? lockedNumber(reorderPriceLock, "shippingCents") : defaultShippingChargeCents)));
  const [tax, setTax] = useState(dollars(existingQuote?.tax_cents));
  const [taxMode, setTaxMode] = useState<"automatic" | "manual" | "exempt">(existingQuote?.tax_mode || "automatic");
  const [taxCalculationId, setTaxCalculationId] = useState(existingQuote?.stripe_tax_calculation_id || "");
  const [taxCalculatedAt, setTaxCalculatedAt] = useState(existingQuote?.tax_calculated_at || "");
  const [taxInputFingerprint, setTaxInputFingerprint] = useState(existingQuote?.tax_input_fingerprint || "");
  const [taxExemptReason, setTaxExemptReason] = useState(existingQuote?.tax_exempt_reason || "");
  const [taxBreakdown, setTaxBreakdown] = useState<Record<string, unknown> | null>(existingQuote?.tax_breakdown || null);
  const [taxLocation, setTaxLocation] = useState<string>("");
  const [calculatingTax, setCalculatingTax] = useState(false);
  const [manualDiscount, setManualDiscount] = useState(dollars(existingQuote?.manual_discount_cents ?? existingQuote?.discount_cents ?? (isReorderPriceLocked ? lockedNumber(reorderPriceLock, "manualDiscountCents") : 0)));
  const [discountCode, setDiscountCode] = useState(existingQuote?.applied_discount_code || (isReorderPriceLocked ? String(reorderPriceLock?.discountCode || "") : requestedDiscountCode) || "");
  const [supplyCost, setSupplyCost] = useState(existingQuote ? dollars(existingQuote.internal_supply_cost_cents) : dollars(pricingDefaults.supply));
  const [supplierCostRows, setSupplierCostRows] = useState<SupplierCostRow[]>(defaultSupplierRows);
  const [printCost, setPrintCost] = useState(existingQuote ? dollars(existingQuote.internal_print_cost_cents) : dollars(pricingDefaults.print));
  const [packagingCost, setPackagingCost] = useState(existingQuote ? dollars(existingQuote.internal_packaging_cost_cents) : dollars(pricingDefaults.packaging));
  const [shippingCost, setShippingCost] = useState(dollars(existingQuote?.internal_shipping_cost_cents));
  const [otherCost, setOtherCost] = useState(dollars(existingQuote?.internal_other_cost_cents));
  const [laborHours, setLaborHours] = useState(existingQuote?.labor_hours && existingQuote.labor_hours > 0 ? String(existingQuote.labor_hours) : String(suggestedLaborHours));
  const [laborRate, setLaborRate] = useState(existingQuote?.labor_rate_cents ? (existingQuote.labor_rate_cents / 100).toFixed(2) : (defaultLaborRateCents / 100).toFixed(2));
  const [revisionReason, setRevisionReason] = useState("");
  const [notes, setNotes] = useState(existingQuote?.notes ?? "");
  const [validUntil, setValidUntil] = useState(existingQuote?.valid_until ?? "");
  const [paymentTerms, setPaymentTerms] = useState<"full" | "deposit">(existingQuote?.payment_terms === "deposit" || (!existingQuote && isReorderPriceLocked && reorderPriceLock?.paymentTerms === "deposit") ? "deposit" : "full");
  const [depositAmount, setDepositAmount] = useState(dollars(existingQuote?.deposit_amount_cents ?? (isReorderPriceLocked ? lockedNumber(reorderPriceLock, "depositAmountCents") : 0)));
  const [isOutsourcedOrder, setIsOutsourcedOrder] = useState(Boolean(existingQuote?.is_outsourced_order));
  const [profitabilityOverride, setProfitabilityOverride] = useState(Boolean(existingQuote?.profitability_override_reason));
  const [profitabilityOverrideReason, setProfitabilityOverrideReason] = useState(existingQuote?.profitability_override_reason || "");
  const [customerIdeasReviewed, setCustomerIdeasReviewed] = useState(existingQuote?.status === "sent" || existingQuote?.status === "approved");
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
  const [mockupImportChecked, setMockupImportChecked] = useState(false);
  const [hasSavedMockup, setHasSavedMockup] = useState(Boolean(existingQuote?.mockup_snapshot));
  const [useSavedMockup, setUseSavedMockup] = useState(Boolean(existingQuote?.mockup_snapshot) || !existingQuote);
  const [mockupCustomerDirections, setMockupCustomerDirections] = useState<string[]>([]);
  const [unplacedMockupArtwork, setUnplacedMockupArtwork] = useState<string[]>([]);
  const effectiveCustomerIdeas = Array.from(new Set([...customerIdeas, ...mockupCustomerDirections]));

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
  const supplierProductCalculatedCents = supplierCostRows.filter((row) => !row.key.startsWith("__supplier_")).reduce((sum, row) => sum + row.quantity * centsFromInput(row.unitCost), 0);
  const supplierShippingCents = supplierCostRows.filter((row) => row.key === "__supplier_shipping__").reduce((sum, row) => sum + row.quantity * centsFromInput(row.unitCost), 0);
  const supplierTaxCents = supplierCostRows.filter((row) => row.key === "__supplier_tax__").reduce((sum, row) => sum + row.quantity * centsFromInput(row.unitCost), 0);
  const supplierCalculatedCents = supplierProductCalculatedCents + supplierShippingCents + supplierTaxCents;
  const total = Math.max(0, subtotal + centsFromInput(setupFee) + centsFromInput(shipping) + effectiveTaxCents - totalDiscount);
  const safeLaborHours = Math.max(0, Number(laborHours) || 0);
  const laborCost = Math.round(safeLaborHours * centsFromInput(laborRate));
  const revenueBeforeTax = Math.max(0, subtotal + centsFromInput(setupFee) + centsFromInput(shipping) - totalDiscount);
  const overheadCents = Math.ceil(revenueBeforeTax * Math.max(0, Number(businessSettings?.overhead_basis_points ?? 1000)) / 10000);
  const paymentFeeCents = estimatedPaymentFeeCents({ amountCents: total, paymentTerms, depositAmountCents: centsFromInput(depositAmount), settings: businessSettings });
  const baseInternalCost = centsFromInput(supplyCost) + centsFromInput(printCost) + centsFromInput(packagingCost) + supplierShippingCents + supplierTaxCents + centsFromInput(shippingCost) + centsFromInput(otherCost) + laborCost;
  const internalTotalCost = baseInternalCost + paymentFeeCents + overheadCents;
  const estimatedProfit = revenueBeforeTax - internalTotalCost;
  const marginPercent = revenueBeforeTax > 0 ? (estimatedProfit / revenueBeforeTax) * 100 : 0;
  const targetMarginBasisPoints = isOutsourcedOrder
    ? Number(businessSettings?.outsourced_min_margin_basis_points ?? 3500)
    : quantityTargetMarginBasisPoints;
  const minimumProfitPerItemCents = Math.ceil(pricingDefaults.minimumProfit / totalOrderQuantity);
  const recommendedRevenue = recommendedRevenueWithSafeguards({
    baseCostCents: baseInternalCost,
    quantity: totalOrderQuantity,
    targetMarginBasisPoints,
    minimumProfitPerItemCents: isOutsourcedOrder ? 0 : minimumProfitPerItemCents,
    settings: businessSettings,
    paymentCount: paymentTerms === "deposit" ? 2 : 1,
  });
  const setupFeeCents = centsFromInput(setupFee);
  const shippingChargedCents = centsFromInput(shipping);
  const manualDiscountCents = centsFromInput(manualDiscount);
  const selectedPercentRate = selectedDiscountCode?.kind === "percent"
    ? Math.min(0.99, Math.max(0, Number(selectedDiscountCode.percent_off || 0) / 100))
    : 0;
  const selectedFixedDiscountCents = selectedDiscountCode?.kind === "fixed"
    ? Math.max(0, Number(selectedDiscountCode.amount_off_cents || 0))
    : 0;
  const recommendedEligibleSubtotal = selectedPercentRate > 0
    ? Math.ceil(Math.max(0, recommendedRevenue - shippingChargedCents + manualDiscountCents) / (1 - selectedPercentRate))
    : Math.max(0, recommendedRevenue - shippingChargedCents + manualDiscountCents + selectedFixedDiscountCents);
  const recommendedLineSubtotal = Math.max(0, recommendedEligibleSubtotal - setupFeeCents);
  const quotedPieceCount = lineItems.reduce((sum, item) => sum + Math.max(1, item.quantity), 0);
  const recommendedAverageUnitPrice = quotedPieceCount > 0
    ? Math.ceil(recommendedLineSubtotal / quotedPieceCount)
    : recommendedLineSubtotal;
  const recommendationGap = recommendedRevenue - revenueBeforeTax;
  const remainingAfterPayments = Math.max(0, total - amountPaidCents);
  const overpaidCents = Math.max(0, amountPaidCents - total);
  const minimumMarginFloorBasisPoints = isOutsourcedOrder
    ? Number(businessSettings?.outsourced_min_margin_basis_points ?? 3500)
    : Number(businessSettings?.minimum_margin_floor_basis_points ?? Math.min(4000, targetMarginBasisPoints));
  const minimumProfitTotalCents = isOutsourcedOrder ? 0 : pricingDefaults.minimumProfit;
  const minimumExpectedLaborHours = suggestedLaborHours;
  const profitabilityWarnings = [
    marginPercent * 100 < minimumMarginFloorBasisPoints ? `True margin is ${marginPercent.toFixed(1)}%, below the ${(minimumMarginFloorBasisPoints / 100).toFixed(1)}% floor.` : "",
    minimumProfitTotalCents > 0 && estimatedProfit < minimumProfitTotalCents ? `Estimated profit is ${money(estimatedProfit)}; this order needs at least ${money(minimumProfitTotalCents)} (${money(minimumProfitPerItemCents)} per item).` : "",
    centsFromInput(supplyCost) <= 0 ? "Supplier/product cost is missing or $0." : "",
    total > 0 && paymentFeeCents <= 0 ? "Payment fees have not been calculated." : "",
    safeLaborHours + 0.001 < minimumExpectedLaborHours ? `Labor may be too low. Enter total person-hours; the current warning threshold is ${minimumExpectedLaborHours.toFixed(1)} hours.` : "",
    locationCount > 1 && centsFromInput(printCost) + 1 < pricingDefaults.print ? `This is a ${locationCount}-location order, but the printing total does not include the configured additional-location cost.` : "",
    centsFromInput(shippingCost) > centsFromInput(shipping) ? `Moore Made's shipping/delivery cost (${money(centsFromInput(shippingCost))}) exceeds the customer charge (${money(centsFromInput(shipping))}).` : "",
    totalDiscount > 0 && marginPercent * 100 < minimumMarginFloorBasisPoints ? "The discount pushes this order below the profit floor." : "",
  ].filter(Boolean);
  const weeklySalesGoalCents = Number(businessSettings?.weekly_sales_goal_cents ?? 750000);
  const weeklyProfitGoalCents = Number(businessSettings?.weekly_profit_goal_cents ?? 300000);
  const weeklyOwnerGoalCents = Number(businessSettings?.weekly_owner_goal_cents ?? 270000);
  const weeklyReserveGoalCents = Number(businessSettings?.weekly_reserve_goal_cents ?? 30000);
  const quoteWeeklyProfitContribution = weeklyProfitGoalCents > 0 ? Math.max(0, estimatedProfit) / weeklyProfitGoalCents * 100 : 0;

  function applySuggestedJobCosts() {
    if (locked) return;
    setSupplyCost((pricingDefaults.supply / 100).toFixed(2));
    setPrintCost((pricingDefaults.print / 100).toFixed(2));
    setPackagingCost((pricingDefaults.packaging / 100).toFixed(2));
    // Labor belongs to the whole quote. Product count and product categories must
    // never multiply the order's minimum labor charge.
    setLaborHours(String(suggestedLaborHours));
    setLaborRate((defaultLaborRateCents / 100).toFixed(2));
    setMessage("Editable starter job costs applied. Payment fees and overhead now recalculate automatically from the current quote.");
    setError("");
  }

  function updateSupplierCost(key: string, unitCost: string) {
    setSupplierCostRows((current) => current.map((row) => row.key === key ? { ...row, unitCost } : row));
  }

  function useSupplierCalculatedTotal() {
    setSupplyCost((supplierProductCalculatedCents / 100).toFixed(2));
    setMessage("The size-by-size product total was copied into blank/product cost. Supplier shipping and tax remain separate in the private breakdown.");
    setError("");
  }

  function applyRecommendedPricing() {
    if (locked || isReorderPriceLocked || lines.length === 0) return;

    const targetSubtotal = Math.max(0, recommendedLineSubtotal);
    const quantities = lines.map((line) => Math.max(1, Math.floor(Number(line.quantity) || 1)));
    const totalQuantity = quantities.reduce((sum, qty) => sum + qty, 0);
    if (totalQuantity <= 0) return;

    setLines((current) => {
      if (current.length === 1) {
        const quantity = Math.max(1, Math.floor(Number(current[0].quantity) || 1));
        const unitPriceCents = Math.ceil(targetSubtotal / quantity);
        return [{ ...current[0], unitPrice: (unitPriceCents / 100).toFixed(2) }];
      }

      const currentSubtotal = current.reduce((sum, line, index) => {
        return sum + quantities[index] * centsFromInput(line.unitPrice);
      }, 0);

      if (currentSubtotal > 0) {
        const factor = targetSubtotal / currentSubtotal;
        return current.map((line) => ({
          ...line,
          unitPrice: (Math.max(0, Math.round(centsFromInput(line.unitPrice) * factor)) / 100).toFixed(2),
        }));
      }

      const averageUnitPriceCents = Math.ceil(targetSubtotal / totalQuantity);
      return current.map((line) => ({
        ...line,
        unitPrice: (averageUnitPriceCents / 100).toFixed(2),
      }));
    });

    setError("");
    setMessage("Recommended pricing applied. You can still adjust any line item before sending the quote.");
  }

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
      const missingArtwork = missingPreviewArtworkViews(result?.document || { views: [] });
      setUnplacedMockupArtwork(missingArtwork.map((view) => view.name));
      const savedDirections = Array.isArray(result?.document?.views) ? result.document.views.flatMap((view: { name?: string; template?: { productName?: string; colorName?: string }; customerIntent?: { enabled?: boolean; source?: string; idea?: string; details?: string; artworkFileName?: string; placementLabel?: string; placement?: string } }) => {
        const intent = view.customerIntent;
        if (!intent?.enabled) return [];
        const title = [view.template?.productName || view.name || "Mockup", view.template?.colorName].filter(Boolean).join(" · ");
        const direction = intent.source === "upload"
          ? `uploaded artwork: ${intent.artworkFileName || "customer file"}; placement: ${intent.placementLabel || intent.placement || "Custom placement"}.`
          : intent.idea || "Customer requested a design for this view.";
        return [`${title}: ${direction}${intent.details ? ` · ${intent.details}` : ""}`];
      }) : [];
      setMockupCustomerDirections(savedDirections);
      setHasSavedMockup(hasDocument);
      if (hasDocument && !existingQuote) setUseSavedMockup(missingArtwork.length === 0);
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
    if (locked || mockupImportChecked) return;
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

  async function requestAutomaticTax() {
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

    const taxCents = Math.max(0, Number(result.taxCents || 0));
    const calculationId = String(result.calculationId || "");
    const calculatedAt = String(result.calculatedAt || new Date().toISOString());
    const inputFingerprint = String(result.inputFingerprint || currentTaxInputFingerprint);
    const breakdown = result.breakdown && typeof result.breakdown === "object" ? result.breakdown : null;
    const location = result.location;
    const locationLabel = location ? `${location.city}, ${location.state} ${location.postalCode}` : "";

    setTax((taxCents / 100).toFixed(2));
    setTaxCalculationId(calculationId);
    setTaxCalculatedAt(calculatedAt);
    setTaxInputFingerprint(inputFingerprint);
    setTaxBreakdown(breakdown);
    setTaxLocation(locationLabel);

    return {
      taxCents,
      calculationId,
      calculatedAt,
      inputFingerprint,
      breakdown,
      location,
      locationLabel,
    };
  }

  async function calculateAutomaticTax() {
    setError("");
    setMessage("");
    if (!automaticTaxPrerequisitesMet) {
      setError(hasFulfillmentMethod ? `Complete and save the ${fulfillmentMode === "shipping" ? "shipping" : "local delivery"} address in the Fulfillment section first.` : "Choose and save Local pickup, Local delivery, or Shipping in the Fulfillment section first.");
      document.getElementById(`fulfillment-${requestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setCalculatingTax(true);
    try {
      const result = await requestAutomaticTax();
      setMessage(`Automatic sales tax calculated${result.location ? ` for ${result.location.city}, ${result.location.state}` : ""}.`);
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
    if (taxMode === "exempt" && taxExemptReason.trim().length < 3) {
      setError("Add a reason or exemption-document note for a tax-exempt quote.");
      return;
    }
    if (action === "send" && taxMode === "automatic" && !automaticTaxPrerequisitesMet) {
      setError(hasFulfillmentMethod ? "Complete and save the destination address before calculating tax and sending the quote." : "Choose and save a fulfillment method before calculating tax and sending the quote.");
      document.getElementById(`fulfillment-${requestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
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
    if (action === "send" && effectiveCustomerIdeas.length > 0 && !customerIdeasReviewed) {
      setError("Review and check every customer idea/artwork direction before sending the proof and quote.");
      return;
    }
    if (action === "send" && useSavedMockup && unplacedMockupArtwork.length) {
      setError(`The saved mockup is missing visible customer artwork on ${unplacedMockupArtwork.join(", ")}. Place the file in Mockup Studio, or turn off the saved mockup and attach a finished proof file instead.`);
      return;
    }
    if (action === "send" && profitabilityWarnings.length > 0 && (!profitabilityOverride || profitabilityOverrideReason.trim().length < 5)) {
      setError("This quote has profitability warnings. To send it anyway, choose the override and enter a clear reason.");
      return;
    }

    setSaving(true);
    let submitTaxCents = effectiveTaxCents;
    let submitTaxCalculationId = automaticTaxFresh ? taxCalculationId : "";
    let submitTaxCalculatedAt = automaticTaxFresh ? taxCalculatedAt : "";
    let submitTaxInputFingerprint = automaticTaxFresh ? taxInputFingerprint : "";
    let submitTaxBreakdown = automaticTaxFresh ? taxBreakdown : null;

    try {
      if (action === "send" && taxMode === "automatic") {
        setCalculatingTax(true);
        setMessage("Checking the latest sales tax before sending…");
        try {
          const latestTax = await requestAutomaticTax();
          submitTaxCents = latestTax.taxCents;
          submitTaxCalculationId = latestTax.calculationId;
          submitTaxCalculatedAt = latestTax.calculatedAt;
          submitTaxInputFingerprint = latestTax.inputFingerprint;
          submitTaxBreakdown = latestTax.breakdown;
        } finally {
          setCalculatingTax(false);
        }
      } else if (taxMode === "exempt") {
        submitTaxCents = 0;
      }

      const submitTotal = Math.max(
        0,
        subtotal
          + centsFromInput(setupFee)
          + centsFromInput(shipping)
          + submitTaxCents
          - totalDiscount
      );
      const depositCents = centsFromInput(depositAmount);
      if (paymentTerms === "deposit" && (depositCents <= 0 || depositCents >= submitTotal)) {
        throw new Error("Custom deposit must be greater than $0 and less than the full quote total.");
      }
      const submitPaymentFeeCents = estimatedPaymentFeeCents({ amountCents: submitTotal, paymentTerms, depositAmountCents: depositCents, settings: businessSettings });

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
          taxCents: submitTaxCents,
          taxMode,
          stripeTaxCalculationId: taxMode === "automatic" ? submitTaxCalculationId || null : null,
          taxCalculatedAt: taxMode === "automatic" ? submitTaxCalculatedAt || null : null,
          taxInputFingerprint: taxMode === "automatic" ? submitTaxInputFingerprint || null : null,
          taxBreakdown: taxMode === "automatic" ? submitTaxBreakdown : null,
          taxCode: quoteTaxCode,
          taxExemptReason: taxMode === "exempt" ? taxExemptReason.trim() : null,
          manualDiscountCents: centsFromInput(manualDiscount),
          discountCode: normalizedDiscountCode,
          internalSupplyCostCents: centsFromInput(supplyCost),
          internalSupplierCosts: supplierCostRows.map((row) => ({ ...row, unitCostCents: centsFromInput(row.unitCost), unitCost: undefined })),
          internalPrintCostCents: centsFromInput(printCost),
          internalPackagingCostCents: centsFromInput(packagingCost),
          internalSupplierShippingCents: supplierShippingCents,
          internalSupplierTaxCents: supplierTaxCents,
          internalShippingCostCents: centsFromInput(shippingCost),
          internalPaymentFeeCents: submitPaymentFeeCents,
          internalOverheadCents: overheadCents,
          internalOtherCostCents: centsFromInput(otherCost),
          laborHours: safeLaborHours,
          laborRateCents: centsFromInput(laborRate),
          isOutsourcedOrder,
          profitabilityWarnings,
          profitabilityOverrideReason: profitabilityWarnings.length ? profitabilityOverrideReason.trim() : "",
          customerIdeasReviewed,
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
              <div><span className="eyebrow">Product proofs</span><h5>Create or upload the customer proof</h5><p>Use a saved Shop/Mockup Studio design, or upload a mockup you created in Canva, Photoshop, or another program.</p></div>
              <div className="proofBuilderHeaderActions">
                {!locked && proofItems[0] ? <>
                  <input
                    className="manualProofUploadInput"
                    id={`quickProofUpload-${requestId}`}
                    type="file"
                    multiple
                    accept="image/*,.pdf"
                    onChange={(event) => { chooseProofs(0, event.target.files); event.currentTarget.value = ""; }}
                  />
                  <label className="btn secondary manualProofUploadButton" htmlFor={`quickProofUpload-${requestId}`}>Upload mockup / PDF</label>
                </> : null}
                <button className="btn secondary" type="button" disabled={locked || importingMockups} onClick={() => importMockupStudio(false)}>{importingMockups ? "Checking…" : "Check saved mockup"}</button>
                <span className="proofVersionBadge">Version {displayVersion}</span>
              </div>
            </div>

            {effectiveCustomerIdeas.length ? <div className="quoteCustomerIdeasCheck">
              <div><span className="eyebrow">Required idea check</span><strong>Confirm every customer direction made it into the proof</strong><small>This prevents a tote idea, separate design, back location, or artwork note from being missed.</small></div>
              <ul>{effectiveCustomerIdeas.map((idea, index) => <li key={`${idea}-${index}`}>{idea}</li>)}</ul>
              <label><input type="checkbox" checked={customerIdeasReviewed} onChange={(event) => setCustomerIdeasReviewed(event.target.checked)} disabled={locked} /><span><strong>I reviewed every customer idea above</strong><small>Required before this proof and quote can be sent.</small></span></label>
            </div> : null}

            {hasSavedMockup ? <label className={`savedMockupQuoteOption ${useSavedMockup ? "selected" : ""} ${unplacedMockupArtwork.length ? "needsArtwork" : ""}`}>
              <input type="checkbox" checked={useSavedMockup} onChange={(event) => setUseSavedMockup(event.target.checked)} disabled={locked || Boolean(unplacedMockupArtwork.length)} />
              <span><strong>{unplacedMockupArtwork.length ? "Saved mockup is not ready to attach" : "Attach the current saved mockup to this quote"}</strong><small>{unplacedMockupArtwork.length ? `Customer artwork is not visible on ${unplacedMockupArtwork.join(", ")}. Fix it in Mockup Studio, or attach a finished external proof instead.` : "Recommended. Moore Made freezes a copy when the quote is sent, so later edits cannot change what the customer approved."}</small></span>
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
            <div className="proofBuilderHeading"><div><span className="eyebrow">Quote setup</span><h5>Build the customer quote</h5><p>Work through the five steps below. Customer prices remain exactly as you enter them; private costs are used only to help Moore Made check profit.</p></div></div>

            <div className="quoteAdminGuide" aria-label="Quote setup steps">
              <div><span>1</span><strong>Set customer price</strong></div>
              <div><span>2</span><strong>Check cost & profit</strong></div>
              <div><span>3</span><strong>Handle tax & discounts</strong></div>
              <div><span>4</span><strong>Choose payment terms</strong></div>
              <div><span>5</span><strong>Review & send</strong></div>
            </div>

            <div className="manualQuoteNotice">
              <div><span>Step 1 · Customer price</span><strong>What should the customer pay?</strong><small>New quotes start at the profitable safeguarded price. You can still override it unless this is a completed-order reorder.</small></div>
              {!locked && !isReorderPriceLocked ? <button className="btn quoteApplySuggestedPrice" type="button" onClick={applyRecommendedPricing}>Use suggested customer price</button> : null}
            </div>

            {isReorderPriceLocked ? <div className="reorderPriceLockNotice"><strong>Completed-order price lock</strong><span>Original item prices, setup, discounts, and payment terms are preserved. {fulfillmentChangedOnReorder ? "The fulfillment method changed, so shipping and tax must be recalculated." : "Original shipping is preserved; tax is recalculated from the current fulfillment details."}</span></div> : null}

            <div className="quoteLineHeader"><span>What the customer is buying</span><span>Quantity</span><span>Price each</span><span></span></div>
            {lines.map((line, index) => (
              <div className="quoteLine" key={index}>
                <input aria-label={`Line ${index + 1} description`} value={line.description} onChange={(e) => updateLine(index, "description", e.target.value)} disabled={locked || isReorderPriceLocked} />
                <input aria-label={`Line ${index + 1} quantity`} type="number" min="1" value={line.quantity} onChange={(e) => updateLine(index, "quantity", e.target.value)} disabled={locked || isReorderPriceLocked} />
                <div className="moneyInput"><span>$</span><input aria-label={`Line ${index + 1} unit price`} type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(index, "unitPrice", e.target.value)} disabled={locked || isReorderPriceLocked} /></div>
                <button className="quoteRemove" type="button" aria-label="Remove line" disabled={locked || isReorderPriceLocked || lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>×</button>
              </div>
            ))}
            {!locked && !isReorderPriceLocked ? <button className="textButton" type="button" onClick={() => setLines((current) => [...current, { description: "", quantity: "1", unitPrice: "" }])}>+ Add customer charge</button> : null}

            <div className="quoteExtras">
              <label><span>Artwork recreation / setup fee <small>Optional</small></span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={setupFee} onChange={(e) => setSetupFee(e.target.value)} disabled={locked || isReorderPriceLocked} /></div></label>
              <label><span>Delivery/shipping charged to customer <small>Optional</small></span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={shipping} onChange={(e) => setShipping(e.target.value)} disabled={locked || shippingPriceLocked} /></div></label>
              <label><span>Extra dollar discount <small>Optional</small></span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={manualDiscount} onChange={(e) => setManualDiscount(e.target.value)} disabled={locked || isReorderPriceLocked} /></div></label>
            </div>

            <div className="customerPriceRunningTotal"><div><span>Current customer price before sales tax</span><small>Products + customer fees/shipping − discounts</small></div><strong>{money(revenueBeforeTax)}</strong></div>
            <div className="customerChargeExplanation"><strong>Customer-facing breakdown</strong><span>Product prices may include the blank/product, standard decoration, production labor, overhead, and Moore Made&apos;s profit. Never expose supplier costs, labor rates, payment fees, overhead, or profit. Show separate charges only for legitimate customer-facing additions such as artwork recreation, extra print locations, oversized garments, or shipping.</span></div>

            <div className="quoteTaxPanel">
              <div className="proofBuilderHeading"><div><span className="eyebrow">Step 3 · Tax & discounts</span><h5>How should sales tax be handled?</h5><p>Use Automatic for normal orders. The quote shows an estimate from the saved fulfillment address; automatic tax is checked again immediately before payment.</p></div></div>
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
                  <div><span>Estimated sales tax for quote</span><strong>{money(effectiveTaxCents)}</strong><small>{automaticTaxPrerequisitesMet ? `Fulfillment: ${fulfillmentMethodLabel} · ${automaticTaxFresh ? `Current estimate${taxLocation ? ` · ${taxLocation}` : ""}${taxCalculatedAt ? ` · ${new Date(taxCalculatedAt).toLocaleString("en-US", { timeZone: "America/New_York" })}` : ""}` : taxCalculationId ? "Price/address changed — recalculate before sending." : "Not calculated yet."}` : hasFulfillmentMethod ? `${fulfillmentMethodLabel} needs a complete saved destination address.` : "Fulfillment method required before tax can be calculated."}</small></div>
                  {automaticTaxPrerequisitesMet ? <button className="btn secondary" type="button" disabled={locked || calculatingTax} onClick={calculateAutomaticTax}>{calculatingTax ? "Calculating…" : automaticTaxFresh ? "Recalculate tax" : "Calculate tax"}</button> : <button className="btn secondary taxFulfillmentButton" type="button" disabled={locked} onClick={() => document.getElementById(`fulfillment-${requestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>{hasFulfillmentMethod ? "Complete address below ↓" : "Choose fulfillment below ↓"}</button>}
                  <p className="fieldHelp">Stripe Tax uses the complete destination address anywhere in the U.S. A $0 result can be correct when Moore Made is not registered to collect there—do not manually add Ohio tax to an out-of-state order.</p>
                </div>
              ) : taxMode === "manual" ? (
                <label className="field taxManualField"><span>Sales tax amount</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} disabled={locked} /></div></label>
              ) : (
                <label className="field taxExemptField"><span>Tax-exempt reason / documentation note *</span><input value={taxExemptReason} onChange={(e) => setTaxExemptReason(e.target.value)} disabled={locked} maxLength={1000} placeholder="Example: Resale certificate on file — customer certificate dated …" /></label>
              )}
            </div>

            <div className="quoteDiscountEditor">
              <div className="proofBuilderHeading"><div><span className="eyebrow">Optional discount</span><h5>Promo or family code</h5><p>Leave this blank unless the customer has a valid code. The dollar discount from Step 1 and a promo code can be combined.</p></div></div>
              <div className="twoCol">
                <label className="field"><span>Discount code <small>Optional</small></span><input value={discountCode} onChange={(e) => setDiscountCode(e.target.value.toUpperCase())} list={`discount-codes-${requestId}`} placeholder="FAMILY10" disabled={locked || isReorderPriceLocked} /><datalist id={`discount-codes-${requestId}`}>{discountCodes.filter((code) => code.active && !code.retired_at).map((code) => <option value={code.code} key={code.id}>{code.description || code.code}</option>)}</datalist>{requestedDiscountCode && !existingQuote?.applied_discount_code ? <small className="fieldHelp">Customer entered: <strong>{requestedDiscountCode}</strong></small> : null}</label>
                <div className="quoteDiscountPreview"><span>Promo discount</span><strong>{selectedDiscountCode ? `−${money(promoDiscount)}` : normalizedDiscountCode ? "Validated when saved" : money(0)}</strong><small>{selectedDiscountCode?.description || (normalizedDiscountCode ? "The server will verify status, dates, limits, and minimum order." : "No promo code applied")}</small></div>
              </div>
            </div>

            <details className="internalCostPanel adminCostDisclosure">
              <summary>
                <div className="adminCostSummaryTitle"><span>2</span><div><strong>Check Moore Made&apos;s cost and profit</strong><small>Private—customers never see these numbers. Expand before tax to verify that the quote is profitable.</small></div></div>
                <div className="adminCostSummaryNumbers"><span>Estimated cost <strong>{money(internalTotalCost)}</strong></span><span>Estimated profit <strong className={estimatedProfit < 0 ? "profitLossText" : "profitPositiveText"}>{money(estimatedProfit)}</strong></span>{profitabilityWarnings.length ? <span className="profitabilityWarningCount">Pre-send check <strong>{profitabilityWarnings.length} warning{profitabilityWarnings.length === 1 ? "" : "s"}</strong></span> : <span className="profitabilityPassedCount">Pre-send check <strong>Passed</strong></span>}</div>
              </summary>
              <div className="adminCostDisclosureBody">
                <div className="proofBuilderHeading"><div><span className="eyebrow">Step 2 · Private cost check</span><h5>What will this entire order cost Moore Made?</h5><p>Enter totals for the whole order—not per-item amounts. Never count the same cost twice. Estimates are fine before production; your financial log can hold the final actual amounts.</p></div>{!locked ? <button className="btn secondary" type="button" onClick={applySuggestedJobCosts}>Use starter estimates</button> : null}</div>
                <label className="outsourcedOrderToggle"><input type="checkbox" checked={isOutsourcedOrder} onChange={(event) => setIsOutsourcedOrder(event.target.checked)} disabled={locked} /><span><strong>This is an outsourced order</strong><small>Uses the configured outsourced minimum margin ({(Number(businessSettings?.outsourced_min_margin_basis_points ?? 3500) / 100).toFixed(0)}%).</small></span></label>

                <div className="adminCostGroup">
                  <div className="adminCostGroupHead"><strong>Products and production</strong><span>Use only the fields that apply.</span></div>
                  {supplierCostRows.length ? <div className="supplierCostCalculator">
                    <div className="supplierCostIntro"><div><strong>Jiffy / supplier estimate by size</strong><span>Copy the current product-page price for every size, then add any supplier shipping and supplier tax shown at checkout. Jiffy promotions and bulk pricing can change, so confirm the final receipt later.</span></div><div><span>Calculated supplier total</span><strong>{money(supplierCalculatedCents)}</strong></div></div>
                    <div className="supplierCostHeader"><span>Product / size</span><span>Qty</span><span>Cost each</span><span>Total</span></div>
                    {supplierCostRows.map((row) => <div className="supplierCostRow" key={row.key}><span><strong>{row.productName} · {row.size}</strong><small>{row.colorName || "Color not specified"}</small></span><span>{row.quantity}</span><div className="moneyInput"><span>$</span><input aria-label={`${row.productName} ${row.size} supplier cost each`} type="number" min="0" step="0.01" value={row.unitCost} onChange={(event) => updateSupplierCost(row.key, event.target.value)} disabled={locked} /></div><strong>{money(row.quantity * centsFromInput(row.unitCost))}</strong></div>)}
                    {!locked ? <button className="btn secondary" type="button" onClick={useSupplierCalculatedTotal}>Use {money(supplierProductCalculatedCents)} as product cost</button> : null}
                  </div> : null}
                  <div className="internalCostGrid">
                    <label><span>Blanks/products or outside vendor total</span><small>What Moore Made pays for all products. If a vendor handles the entire order, enter that vendor total here.</small><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={supplyCost} onChange={(e) => setSupplyCost(e.target.value)} disabled={locked} /></div></label>
                    <label><span>Printing/decoration paid separately</span><small>Enter $0 if printing is already included in the vendor total above.</small><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={printCost} onChange={(e) => setPrintCost(e.target.value)} disabled={locked} /></div></label>
                    <label><span>Packaging and production supplies</span><small>Bags, boxes, tape, inserts, or other supplies used for this order.</small><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={packagingCost} onChange={(e) => setPackagingCost(e.target.value)} disabled={locked} /></div></label>
                  </div>
                </div>

                <div className="adminCostGroup">
                  <div className="adminCostGroupHead"><strong>Fulfillment and other expenses</strong><span>Private business costs for this order.</span></div>
                  <div className="internalCostGrid">
                    <label><span>What shipping/delivery costs Moore Made</span><small>The amount Moore Made actually expects to pay—not what the customer is charged.</small><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} disabled={locked} /></div></label>
                    <div className="internalAutoCost"><span>Card/payment fee estimate</span><small>Automatically recalculates from quote price, shipping, tax, discounts, and deposit terms.</small><strong>{money(paymentFeeCents)}</strong></div>
                    <label><span>Any other order cost</span><small>Leave at $0 unless this order has another real expense.</small><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={otherCost} onChange={(e) => setOtherCost(e.target.value)} disabled={locked} /></div></label>
                  </div>
                </div>

                <div className="adminCostGroup laborOrderGroup">
                  <div className="adminCostGroupHead"><strong>Time spent on the whole order</strong><span>Labor is added once to the entire order, never once per product or item.</span></div>
                  <div className="laborCostEditor">
                    <label className="field"><span>Total person-hours for the whole order</span><input type="number" min="0" step="0.5" value={laborHours} onChange={(e) => setLaborHours(e.target.value)} disabled={locked} /><small>Add every person’s time together. The bulk default is {suggestedLaborHours.toFixed(1)} hr: setup is charged once, then each added piece takes less time. Below {minimumExpectedLaborHours.toFixed(1)} hours triggers an override warning.</small></label>
                    <label className="field"><span>Private value per work hour</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.25" value={laborRate} onChange={(e) => setLaborRate(e.target.value)} disabled={locked} /></div><small>This starts at $25/hour, stays editable, and is never shown to the customer.</small></label>
                    <div className="laborCostResult"><span>Total labor for this order</span><strong>{money(laborCost)}</strong><small>{safeLaborHours.toLocaleString()} hr × {money(centsFromInput(laborRate))}/hr</small></div>
                  </div>
                </div>

                <div className="profitabilityCard">
                  <div><span>Estimated order cost</span><strong>{money(internalTotalCost)}</strong></div>
                  <div><span>Customer revenue before tax</span><strong>{money(revenueBeforeTax)}</strong></div>
                  <div className={estimatedProfit < 0 ? "profitLoss" : "profitPositive"}><span>Estimated profit</span><strong>{money(estimatedProfit)}</strong></div>
                  <div><span>Profit margin</span><strong>{marginPercent.toFixed(1)}%</strong></div>
                  <div className="profitRecommendation"><span>Suggested revenue for a {(targetMarginBasisPoints / 100).toFixed(0)}% margin</span><strong>{money(recommendedRevenue)}</strong><small>Suggestion only—Moore Made chooses the final customer price.</small></div>
                </div>

                <div className="weeklyGoalQuoteReference">
                  <div><span>Weekly sales goal</span><strong>{money(weeklySalesGoalCents)}</strong></div>
                  <div><span>Weekly business-profit goal</span><strong>{money(weeklyProfitGoalCents)}</strong></div>
                  <div><span>Combined owner goal</span><strong>{money(weeklyOwnerGoalCents)}</strong></div>
                  <div><span>Business reserve goal</span><strong>{money(weeklyReserveGoalCents)}</strong></div>
                  <p>This quote contributes <strong>{money(Math.max(0, estimatedProfit))}</strong>, or <strong>{quoteWeeklyProfitContribution.toFixed(1)}%</strong>, toward the {money(weeklyProfitGoalCents)} weekly profit goal.</p>
                </div>

                <details className="whyThisPrice" open>
                  <summary>Why this price? · private breakdown</summary>
                  <div className="whyThisPriceRows">
                    <div><span>Customer revenue before tax</span><strong>{money(revenueBeforeTax)}</strong></div>
                    <div><span>Blanks/products</span><strong>{money(centsFromInput(supplyCost))}</strong></div>
                    <div><span>Printing/decoration ({locationCount} location{locationCount === 1 ? "" : "s"})</span><strong>{money(centsFromInput(printCost))}</strong></div>
                    <div><span>Packaging</span><strong>{money(centsFromInput(packagingCost))}</strong></div>
                    <div><span>Supplier shipping/tax</span><strong>{money(supplierShippingCents + supplierTaxCents)}</strong></div>
                    <div><span>Moore Made shipping/delivery cost</span><strong>{money(centsFromInput(shippingCost))}</strong></div>
                    <div><span>Payment fee</span><strong>{money(paymentFeeCents)}</strong></div>
                    <div><span>Labor</span><strong>{money(laborCost)}</strong></div>
                    <div><span>Overhead reserve ({(Number(businessSettings?.overhead_basis_points ?? 1000) / 100).toFixed(1)}%)</span><strong>{money(overheadCents)}</strong></div>
                    <div><span>Other costs</span><strong>{money(centsFromInput(otherCost))}</strong></div>
                    <div className="whyProfit"><span>Estimated profit</span><strong>{money(estimatedProfit)}</strong></div>
                    <div><span>Profit per item</span><strong>{money(Math.round(estimatedProfit / Math.max(1, totalOrderQuantity)))}</strong></div>
                    <div><span>True profit margin</span><strong>{marginPercent.toFixed(1)}%</strong></div>
                    <div className="whyRecommended"><span>Recommended customer total before tax</span><strong>{money(recommendedRevenue)}</strong></div>
                  </div>
                </details>

                <div className={`profitabilityPreflight ${profitabilityWarnings.length ? "hasWarnings" : "isClear"}`}>
                  <div><span className="eyebrow">Pre-send profitability check</span><strong>{profitabilityWarnings.length ? `${profitabilityWarnings.length} warning${profitabilityWarnings.length === 1 ? "" : "s"} need review` : "Profitability safeguards passed"}</strong></div>
                  {profitabilityWarnings.length ? <ul>{profitabilityWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p>Costs, margin, per-item profit, labor, decoration locations, payment fees, shipping, and discounts passed the current settings.</p>}
                  {profitabilityWarnings.length && !locked ? <div className="profitabilityOverride"><label><input type="checkbox" checked={profitabilityOverride} onChange={(event) => setProfitabilityOverride(event.target.checked)} /><span>I intentionally approve sending below a safeguard</span></label>{profitabilityOverride ? <label className="field"><span>Required override reason</span><textarea value={profitabilityOverrideReason} onChange={(event) => setProfitabilityOverrideReason(event.target.value)} maxLength={1000} placeholder="Explain why this quote is still acceptable…" /></label> : null}</div> : null}
                </div>

                <details className="quotePricingSuggestionDetails">
                  <summary><span>Want help choosing the customer price?</span><small>Show the optional price suggestion</small></summary>
                  <div className="quotePricingSuggestion">
                    <div><span>Suggested customer total before tax</span><strong>{money(recommendedRevenue)}</strong><small>Based on {money(internalTotalCost)} entered cost and a {(targetMarginBasisPoints / 100).toFixed(0)}% target profit margin.</small></div>
                    <div><span>Suggested merchandise subtotal</span><strong>{money(recommendedLineSubtotal)}</strong><small>{setupFeeCents > 0 ? `The suggestion accounts for the ${money(setupFeeCents)} setup fee already entered.` : quotedPieceCount > 0 ? `About ${money(recommendedAverageUnitPrice)} per piece across ${quotedPieceCount} piece${quotedPieceCount === 1 ? "" : "s"}.` : "Add quantities to see a per-piece suggestion."}</small></div>
                    <div className={recommendationGap > 0 ? "suggestionGapNeedsIncrease" : "suggestionGapHealthy"}><span>Your current price compared with the suggestion</span><strong>{recommendationGap === 0 ? "On target" : recommendationGap > 0 ? `${money(recommendationGap)} lower` : `${money(Math.abs(recommendationGap))} higher`}</strong><small>This does not change the quote unless you press the button below.</small></div>
                  </div>
                </details>
              </div>
            </details>

            {approvedQuote && revisionMode ? <div className="quoteRevisionReason"><label className="field"><span>Reason for revision *</span><input value={revisionReason} onChange={(e) => setRevisionReason(e.target.value)} maxLength={500} placeholder="Example: Quantity increased from 4 shirts to 7." /></label></div> : null}

            <div className="paymentTermsEditor">
              <div className="proofBuilderHeading"><div><span className="eyebrow">Step 4 · Payment</span><h5>When should the customer pay?</h5><p>Use full payment for normal orders. Choose a deposit only when Moore Made intentionally wants to collect part now and the remaining balance later.</p></div></div>
              <div className="paymentTermsOptions">
                <label className={`paymentTermOption ${paymentTerms === "full" ? "selected" : ""}`}>
                  <input type="radio" name={`paymentTerms-${requestId}`} value="full" checked={paymentTerms === "full"} onChange={() => setPaymentTerms("full")} disabled={locked || isReorderPriceLocked} />
                  <span><strong>Full payment required</strong><small>{money(total)} due after the customer approves the proof + quote.</small></span>
                </label>
                <label className={`paymentTermOption ${paymentTerms === "deposit" ? "selected" : ""}`}>
                  <input type="radio" name={`paymentTerms-${requestId}`} value="deposit" checked={paymentTerms === "deposit"} onChange={() => setPaymentTerms("deposit")} disabled={locked || isReorderPriceLocked} />
                  <span><strong>Custom deposit</strong><small>Collect a specific amount now; the remaining balance stays attached to the order.</small></span>
                </label>
              </div>
              {paymentTerms === "deposit" ? <div className="depositAmountRow">
                <label className="field"><span>Deposit due after approval</span><div className="moneyInput"><span>$</span><input type="number" min="0.01" step="0.01" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} disabled={locked || isReorderPriceLocked} placeholder="100.00" /></div></label>
                <div className="depositSummary"><span>Remaining balance after deposit</span><strong>{money(Math.max(0, total - centsFromInput(depositAmount)))}</strong></div>
              </div> : null}
            </div>

            <div className="quoteMetaGrid">
              <label className="field"><span>Approval valid until</span><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={locked} /></label>
              <label className="field quoteNotes"><span>Quote / production notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Production timing, material notes, special conditions…" disabled={locked} /></label>
            </div>

            <div className="quoteFinalReview">
              <div className="quoteFinalReviewHead"><span>5</span><div><strong>Review the customer total</strong><small>This is what the customer will receive for approval. Private cost and profit numbers are not included.</small></div></div>
              <div className="quoteTotals">
                <div><span>Items subtotal</span><strong>{money(subtotal)}</strong></div>
                {centsFromInput(setupFee) ? <div><span>Setup/design fee</span><strong>{money(centsFromInput(setupFee))}</strong></div> : null}
                {centsFromInput(shipping) ? <div><span>{fulfillmentChargeLabel}</span><strong>{money(centsFromInput(shipping))}</strong></div> : null}
                {effectiveTaxCents ? <div><span>{taxMode === "automatic" ? "Estimated sales tax" : "Sales tax"}</span><strong>{money(effectiveTaxCents)}</strong></div> : taxMode === "exempt" ? <div><span>Sales tax</span><strong>Exempt</strong></div> : null}
                {centsFromInput(manualDiscount) ? <div><span>Dollar discount</span><strong>−{money(centsFromInput(manualDiscount))}</strong></div> : null}
                {promoDiscount ? <div><span>Promo {normalizedDiscountCode ? `(${normalizedDiscountCode})` : ""}</span><strong>−{money(promoDiscount)}</strong></div> : null}
                <div className="quoteGrandTotal"><span>{taxMode === "automatic" ? "Estimated approval total" : "Final customer total"}</span><strong>{money(total)}</strong></div>
                {amountPaidCents > 0 ? <><div><span>Already paid</span><strong>{money(amountPaidCents)}</strong></div><div><span>Still owed</span><strong>{money(remainingAfterPayments)}</strong></div>{overpaidCents > 0 ? <div className="quoteCreditWarning"><span>Credit / refund review</span><strong>{money(overpaidCents)}</strong></div> : null}</> : null}
              </div>
            </div>
          </section>

          {existingQuote?.revisions?.length ? <section className="quoteRevisionHistory"><div className="proofBuilderHeading"><div><span className="eyebrow">History</span><h5>Quote revisions</h5><p>Earlier sent/approved totals stay in the record instead of being overwritten.</p></div></div><div className="quoteRevisionList">{existingQuote.revisions.map((revision) => <div key={revision.id}><span>Revision {revision.revision_number}</span><strong>{money(revision.total_cents)}</strong><small>{QUOTE_STATUS_LABELS[revision.status]}{revision.revision_reason ? ` · ${revision.revision_reason}` : ""}</small></div>)}</div></section> : null}

          {error ? <div className="formError">{error}</div> : null}
          {message ? <div className="quoteSuccess">{message}</div> : null}
          {!locked ? <div className="quoteActions">{!(approvedQuote && revisionMode) ? <button className="btn secondary" type="button" disabled={saving} onClick={() => submit("save")}>{saving ? "Saving…" : "Save draft"}</button> : null}<button className="btn" type="button" disabled={saving} onClick={() => submit("send")}>{saving ? "Working…" : approvedQuote && revisionMode ? "Send revised price for approval" : existingQuote?.status === "changes_requested" ? "Send updated proof + price" : "Send proof + price for customer approval"}</button></div> : null}
          {waitingOnCustomer ? <ApprovalDeliveryControl requestId={requestId} customerEmail={customerEmail} /> : null}
        </div>
      ) : null}
    </div>
  );
}
