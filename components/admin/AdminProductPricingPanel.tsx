"use client";

import { useMemo, useState } from "react";
import { products } from "@/lib/catalog";
import { money } from "@/lib/quote-types";
import { recommendedRevenueForMargin, type BusinessSettingsRecord, type ProductPricingRecord } from "@/lib/pricing-types";
import { starterPricingFor } from "@/lib/pricing-suggestions";

type EditablePricing = {
  active: boolean;
  blank: string;
  print: string;
  packaging: string;
  margin: string;
  taxCode: string;
  notes: string;
  sizeBlankCosts: Record<string, string>;
  sizeSurcharges: Record<string, string>;
};

function dollars(cents: number | undefined) {
  return ((Number(cents || 0)) / 100).toFixed(2);
}

function cents(value: string) {
  return Math.max(0, Math.round((Number(value) || 0) * 100));
}

export function AdminProductPricingPanel({
  records,
  settings,
  ready,
}: {
  records: ProductPricingRecord[];
  settings: BusinessSettingsRecord | null;
  ready: boolean;
}) {
  const initialMap = useMemo(() => new Map(records.map((row) => [row.product_slug, row])), [records]);
  const [editing, setEditing] = useState<Record<string, EditablePricing>>(() => Object.fromEntries(products.map((product) => {
    const row = initialMap.get(product.slug);
    const starter = starterPricingFor(product.slug);
    return [product.slug, {
      active: row?.active ?? true,
      blank: dollars(row?.blank_cost_cents ?? starter.blankCostCents),
      print: dollars(row?.print_cost_cents ?? starter.printCostCents),
      packaging: dollars(row?.packaging_cost_cents ?? starter.packagingCostCents),
      margin: ((row?.target_margin_basis_points ?? starter.targetMarginBasisPoints) / 100).toFixed(0),
      taxCode: row?.tax_code || settings?.default_tax_code || "txcd_99999999",
      notes: row?.notes || "",
      sizeBlankCosts: Object.fromEntries(product.sizes.map((size) => [size, dollars(row?.size_blank_costs?.[size] ?? starter.sizeBlankCostsCents[size] ?? row?.blank_cost_cents ?? starter.blankCostCents)])),
      sizeSurcharges: Object.fromEntries(product.sizes.map((size) => [size, dollars(row?.size_customer_surcharges?.[size] ?? starter.sizeCustomerSurchargesCents[size] ?? 0)])),
    } satisfies EditablePricing];
  })));
  const [savingSlug, setSavingSlug] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [globalLaborRate, setGlobalLaborRate] = useState(dollars(settings?.default_labor_rate_cents ?? 1500));
  const [minimumLaborHours, setMinimumLaborHours] = useState(String(settings?.minimum_labor_hours ?? 1));
  const pickup = settings?.pickup_address || {};
  const [pickupAddress, setPickupAddress] = useState({
    name: String(pickup.name || "Moore Made"),
    line1: String(pickup.line1 || ""),
    line2: String(pickup.line2 || ""),
    city: String(pickup.city || ""),
    state: String(pickup.state || ""),
    postalCode: String(pickup.postalCode || ""),
    country: String(pickup.country || "US"),
  });
  const [savingSettings, setSavingSettings] = useState(false);

  function patch(slug: string, next: Partial<EditablePricing>) {
    setEditing((current) => ({ ...current, [slug]: { ...current[slug], ...next } }));
  }

  function applyStarter(slug: string) {
    const starter = starterPricingFor(slug);
    patch(slug, {
      blank: dollars(starter.blankCostCents),
      print: dollars(starter.printCostCents),
      packaging: dollars(starter.packagingCostCents),
      margin: (starter.targetMarginBasisPoints / 100).toFixed(0),
      sizeBlankCosts: Object.fromEntries((products.find((product) => product.slug === slug)?.sizes || []).map((size) => [size, dollars(starter.sizeBlankCostsCents[size] ?? starter.blankCostCents)])),
      sizeSurcharges: Object.fromEntries((products.find((product) => product.slug === slug)?.sizes || []).map((size) => [size, dollars(starter.sizeCustomerSurchargesCents[size] ?? 0)])),
    });
    setMessage("Starter estimates filled in. Replace them with your actual supplier and production costs whenever you know them.");
  }

  async function saveProduct(slug: string) {
    const product = products.find((row) => row.slug === slug);
    if (!product) return;
    const row = editing[slug];
    setSavingSlug(slug);
    setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/product-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productSlug: product.slug,
          productName: product.name,
          active: row.active,
          blankCostCents: cents(row.blank),
          sizeBlankCosts: Object.fromEntries(Object.entries(row.sizeBlankCosts).map(([size, amount]) => [size, cents(amount)])),
          sizeCustomerSurcharges: Object.fromEntries(Object.entries(row.sizeSurcharges).map(([size, amount]) => [size, cents(amount)])),
          printCostCents: cents(row.print),
          packagingCostCents: cents(row.packaging),
          // Kept at zero for database compatibility. Labor is configured once
          // in business settings and added once to the complete quote.
          defaultLaborHours: 0,
          laborRateCents: cents(globalLaborRate),
          targetMarginBasisPoints: Math.round(Math.max(0, Math.min(95, Number(row.margin) || 0)) * 100),
          taxCode: row.taxCode,
          notes: row.notes,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save product pricing.");
      setMessage(`${product.name} pricing defaults saved.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save product pricing.");
    } finally {
      setSavingSlug(null);
    }
  }

  async function saveSettings() {
    setSavingSettings(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/product-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "settings",
          defaultLaborRateCents: cents(globalLaborRate),
          minimumLaborHours: Math.max(1, Number(minimumLaborHours) || 1),
          pickupAddress,
          defaultTaxCode: settings?.default_tax_code || "txcd_99999999",
          shippingTaxCode: settings?.shipping_tax_code || "txcd_92010001",
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save business settings.");
      setMessage("Business pricing/tax defaults saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save business settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  if (!ready) return <section className="adminWorkspacePanel"><div className="formError">Products & pricing need the latest database updates. Run Phase 6.26 if it has never been installed, then run <code>supabase/moore_made_phase6_46_size_pricing_final_tax.sql</code>.</div></section>;

  return (
    <section className="adminWorkspacePanel productPricingAdmin">
      <div className="adminSectionIntro"><div><div className="eyebrow">Private pricing engine</div><h2>Products & pricing</h2><p>Unsaved products begin with editable starter estimates. Replace them with your actual blank, transfer, and packaging costs as you receive invoices. Labor is added once to the entire quote, never once per product or item; nothing here appears as a public Shop price.</p></div></div>

      {message ? <div className="formSuccess">{message}</div> : null}
      {error ? <div className="formError">{error}</div> : null}

      <div className="pricingSettingsCard card">
        <div className="pricingSettingsHead"><div><strong>Whole-order labor defaults</strong><span>Applied once to the complete quote, regardless of its quantity or number of product types.</span></div><span className="badge">Admin only</span></div>
        <div className="pricingSettingsGrid">
          <label className="field"><span>Internal labor rate per hour</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.25" value={globalLaborRate} onChange={(e) => setGlobalLaborRate(e.target.value)} /></div><small>Starts at $15/hour and remains private.</small></label>
          <label className="field"><span>Minimum labor for the entire order</span><input type="number" min="1" step="0.25" value={minimumLaborHours} onChange={(e) => setMinimumLaborHours(e.target.value)} /><small>One hour means a $15 minimum for the whole order—not for each item.</small></label>
        </div>
        <div className="pricingPickupSettings">
          <div><strong>Pickup / business address for tax</strong><span>Automatic tax uses this customer location for local-pickup orders.</span></div>
          <div className="pricingSettingsGrid">
            <label className="field"><span>Name</span><input value={pickupAddress.name} onChange={(e) => setPickupAddress({ ...pickupAddress, name: e.target.value })} /></label>
            <label className="field"><span>Street</span><input value={pickupAddress.line1} onChange={(e) => setPickupAddress({ ...pickupAddress, line1: e.target.value })} /></label>
            <label className="field"><span>Suite <small>Optional</small></span><input value={pickupAddress.line2} onChange={(e) => setPickupAddress({ ...pickupAddress, line2: e.target.value })} /></label>
            <label className="field"><span>City</span><input value={pickupAddress.city} onChange={(e) => setPickupAddress({ ...pickupAddress, city: e.target.value })} /></label>
            <label className="field"><span>State</span><input maxLength={2} value={pickupAddress.state} onChange={(e) => setPickupAddress({ ...pickupAddress, state: e.target.value.toUpperCase() })} /></label>
            <label className="field"><span>ZIP</span><input value={pickupAddress.postalCode} onChange={(e) => setPickupAddress({ ...pickupAddress, postalCode: e.target.value })} /></label>
          </div>
        </div>
        <button type="button" className="btn" onClick={saveSettings} disabled={savingSettings}>{savingSettings ? "Saving…" : "Save business defaults"}</button>
      </div>

      <div className="productPricingGrid">
        {products.map((product) => {
          const row = editing[product.slug];
          const directUnitCost = cents(row.blank) + cents(row.print) + cents(row.packaging);
          const recommended = recommendedRevenueForMargin(directUnitCost, Math.round((Number(row.margin) || 0) * 100));
          return (
            <article className="productPricingCard card" key={product.slug}>
              <div className="productPricingCardHead"><div><span className="badge">{product.category}</span><h3>{product.name}</h3></div><label className="pricingActiveToggle"><input type="checkbox" checked={row.active} onChange={(e) => patch(product.slug, { active: e.target.checked })} /><span>Use defaults</span></label></div>
              <div className="productPricingFields">
                <label><span>Blank / product cost each</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={row.blank} onChange={(e) => patch(product.slug, { blank: e.target.value })} /></div></label>
                <label><span>Print / decoration each</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={row.print} onChange={(e) => patch(product.slug, { print: e.target.value })} /></div></label>
                <label><span>Packaging each</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={row.packaging} onChange={(e) => patch(product.slug, { packaging: e.target.value })} /></div></label>
                <label><span>Target margin</span><div className="percentInput"><input type="number" min="0" max="95" step="1" value={row.margin} onChange={(e) => patch(product.slug, { margin: e.target.value })} /><span>%</span></div></label>
              </div>
              <div className="pricingRecommendation"><span>Direct cost per item (before order labor)</span><strong>{money(directUnitCost)}</strong><span>Baseline revenue before order labor at {Number(row.margin) || 0}% margin</span><strong>{money(recommended)}</strong></div>
              {product.sizes.some((size) => /^(?:XS|S|M|L|XL|[2-9]XL)$/i.test(size)) ? <details className="pricingAdvanced pricingSizeCosts"><summary>Supplier cost and customer surcharge by size</summary><p className="fieldHelp">Copy today&apos;s Jiffy price for each size. These remain private estimates. The surcharge is the additional amount the customer sees above the product&apos;s standard price.</p><div className="pricingSizeCostHead"><span>Size</span><span>Jiffy / supplier cost</span><span>Customer surcharge</span></div>{product.sizes.map((size) => <div className="pricingSizeCostRow" key={size}><strong>{size}</strong><div className="moneyInput"><span>$</span><input aria-label={`${product.name} ${size} supplier cost`} type="number" min="0" step="0.01" value={row.sizeBlankCosts[size] || "0.00"} onChange={(event) => patch(product.slug, { sizeBlankCosts: { ...row.sizeBlankCosts, [size]: event.target.value } })} /></div><div className="moneyInput"><span>+$</span><input aria-label={`${product.name} ${size} customer surcharge`} type="number" min="0" step="0.01" value={row.sizeSurcharges[size] || "0.00"} onChange={(event) => patch(product.slug, { sizeSurcharges: { ...row.sizeSurcharges, [size]: event.target.value } })} /></div></div>)}</details> : null}
              <details className="pricingAdvanced"><summary>Advanced</summary><label className="field"><span>Stripe Tax code</span><input value={row.taxCode} onChange={(e) => patch(product.slug, { taxCode: e.target.value })} /></label><label className="field"><span>Internal notes</span><textarea value={row.notes} onChange={(e) => patch(product.slug, { notes: e.target.value })} /></label></details>
              <div className="goalFundingFormActions"><button type="button" className="btn" onClick={() => saveProduct(product.slug)} disabled={savingSlug === product.slug}>{savingSlug === product.slug ? "Saving…" : "Save pricing defaults"}</button><button type="button" className="btn secondary" onClick={() => applyStarter(product.slug)}>Restore starter estimates</button></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
