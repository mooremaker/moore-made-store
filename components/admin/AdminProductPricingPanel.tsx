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
  laborHours: string;
  laborRate: string;
  margin: string;
  taxCode: string;
  notes: string;
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
      laborHours: String(row?.default_labor_hours ?? starter.laborHours),
      laborRate: dollars(row?.labor_rate_cents ?? settings?.default_labor_rate_cents ?? 1000),
      margin: ((row?.target_margin_basis_points ?? starter.targetMarginBasisPoints) / 100).toFixed(0),
      taxCode: row?.tax_code || settings?.default_tax_code || "txcd_99999999",
      notes: row?.notes || "",
    } satisfies EditablePricing];
  })));
  const [savingSlug, setSavingSlug] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [globalLaborRate, setGlobalLaborRate] = useState(dollars(settings?.default_labor_rate_cents ?? 1000));
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
      laborHours: String(starter.laborHours),
      margin: (starter.targetMarginBasisPoints / 100).toFixed(0),
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
          printCostCents: cents(row.print),
          packagingCostCents: cents(row.packaging),
          defaultLaborHours: Math.max(0, Number(row.laborHours) || 0),
          laborRateCents: cents(row.laborRate),
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

  if (!ready) return <section className="adminWorkspacePanel"><div className="formError">Products & pricing need the Phase 6.26 database update. Run <code>supabase/moore_made_phase6_26_ordering_payments_tax.sql</code>.</div></section>;

  return (
    <section className="adminWorkspacePanel productPricingAdmin">
      <div className="adminSectionIntro"><div><div className="eyebrow">Private pricing engine</div><h2>Products & pricing</h2><p>Unsaved products begin with editable starter estimates. Replace them with your actual blank, transfer, and packaging costs as you receive invoices; nothing here appears as a public Shop price.</p></div></div>

      {message ? <div className="formSuccess">{message}</div> : null}
      {error ? <div className="formError">{error}</div> : null}

      <div className="pricingSettingsCard card">
        <div className="pricingSettingsHead"><div><strong>Business defaults</strong><span>Used when a product does not have a more specific setting.</span></div><span className="badge">Admin only</span></div>
        <div className="pricingSettingsGrid">
          <label className="field"><span>Default internal labor rate</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.25" value={globalLaborRate} onChange={(e) => setGlobalLaborRate(e.target.value)} /></div><small>Current plan: $10/hr while owners are doing the work.</small></label>
          <label className="field"><span>Minimum labor per production job</span><input type="number" min="1" step="0.25" value={minimumLaborHours} onChange={(e) => setMinimumLaborHours(e.target.value)} /><small>Current plan: 1 hour minimum.</small></label>
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
          const laborCost = Math.round(Math.max(0, Number(row.laborHours) || 0) * cents(row.laborRate));
          const sampleCost = directUnitCost + laborCost;
          const recommended = recommendedRevenueForMargin(sampleCost, Math.round((Number(row.margin) || 0) * 100));
          return (
            <article className="productPricingCard card" key={product.slug}>
              <div className="productPricingCardHead"><div><span className="badge">{product.category}</span><h3>{product.name}</h3></div><label className="pricingActiveToggle"><input type="checkbox" checked={row.active} onChange={(e) => patch(product.slug, { active: e.target.checked })} /><span>Use defaults</span></label></div>
              <div className="productPricingFields">
                <label><span>Blank / product cost each</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={row.blank} onChange={(e) => patch(product.slug, { blank: e.target.value })} /></div></label>
                <label><span>Print / decoration each</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={row.print} onChange={(e) => patch(product.slug, { print: e.target.value })} /></div></label>
                <label><span>Packaging each</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={row.packaging} onChange={(e) => patch(product.slug, { packaging: e.target.value })} /></div></label>
                <label><span>Default labor hours</span><input type="number" min="0" step="0.25" value={row.laborHours} onChange={(e) => patch(product.slug, { laborHours: e.target.value })} /></label>
                <label><span>Internal labor rate / hr</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.25" value={row.laborRate} onChange={(e) => patch(product.slug, { laborRate: e.target.value })} /></div></label>
                <label><span>Target margin</span><div className="percentInput"><input type="number" min="0" max="95" step="1" value={row.margin} onChange={(e) => patch(product.slug, { margin: e.target.value })} /><span>%</span></div></label>
              </div>
              <div className="pricingRecommendation"><span>Example cost incl. default labor</span><strong>{money(sampleCost)}</strong><span>Suggested revenue at {Number(row.margin) || 0}% margin</span><strong>{money(recommended)}</strong></div>
              <details className="pricingAdvanced"><summary>Advanced</summary><label className="field"><span>Stripe Tax code</span><input value={row.taxCode} onChange={(e) => patch(product.slug, { taxCode: e.target.value })} /></label><label className="field"><span>Internal notes</span><textarea value={row.notes} onChange={(e) => patch(product.slug, { notes: e.target.value })} /></label></details>
              <div className="goalFundingFormActions"><button type="button" className="btn" onClick={() => saveProduct(product.slug)} disabled={savingSlug === product.slug}>{savingSlug === product.slug ? "Saving…" : "Save pricing defaults"}</button><button type="button" className="btn secondary" onClick={() => applyStarter(product.slug)}>Restore starter estimates</button></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
