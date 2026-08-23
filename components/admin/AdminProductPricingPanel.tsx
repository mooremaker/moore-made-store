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
  additionalLocation: string;
  packaging: string;
  minimumProfit: string;
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
      additionalLocation: dollars(row?.additional_location_cost_cents ?? starter.additionalLocationCostCents),
      packaging: dollars(row?.packaging_cost_cents ?? starter.packagingCostCents),
      minimumProfit: dollars(row?.minimum_profit_per_item_cents ?? starter.minimumProfitPerItemCents),
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
  const [globalLaborRate, setGlobalLaborRate] = useState(dollars(settings?.default_labor_rate_cents ?? 2500));
  const [minimumLaborHours, setMinimumLaborHours] = useState(String(settings?.minimum_labor_hours ?? 1));
  const [margin1to9, setMargin1to9] = useState(String((settings?.margin_1_9_basis_points ?? 5500) / 100));
  const [margin10to24, setMargin10to24] = useState(String((settings?.margin_10_24_basis_points ?? 5000) / 100));
  const [margin25to49, setMargin25to49] = useState(String((settings?.margin_25_49_basis_points ?? 4500) / 100));
  const [margin50plus, setMargin50plus] = useState(String((settings?.margin_50_plus_basis_points ?? 4250) / 100));
  const [minimumMarginFloor, setMinimumMarginFloor] = useState(String((settings?.minimum_margin_floor_basis_points ?? 3500) / 100));
  const [standardShirtProfit, setStandardShirtProfit] = useState(dollars(settings?.standard_shirt_min_profit_cents ?? 1200));
  const [outsourcedMargin, setOutsourcedMargin] = useState(String((settings?.outsourced_min_margin_basis_points ?? 3500) / 100));
  const [overheadPercent, setOverheadPercent] = useState(String((settings?.overhead_basis_points ?? 1000) / 100));
  const [paymentFeePercent, setPaymentFeePercent] = useState(String((settings?.payment_fee_basis_points ?? 290) / 100));
  const [paymentFeeFixed, setPaymentFeeFixed] = useState(dollars(settings?.payment_fee_fixed_cents ?? 30));
  const [defaultShippingCharge, setDefaultShippingCharge] = useState(dollars(settings?.default_shipping_charge_cents ?? 0));
  const [incomeTaxReservePercent, setIncomeTaxReservePercent] = useState(String((settings?.income_tax_reserve_basis_points ?? 3000) / 100));
  const [laborMinutesPerPiece, setLaborMinutesPerPiece] = useState(String(settings?.labor_warning_minutes_per_piece ?? 3));
  const [weeklySalesGoal, setWeeklySalesGoal] = useState(dollars(settings?.weekly_sales_goal_cents ?? 750000));
  const [weeklyProfitGoal, setWeeklyProfitGoal] = useState(dollars(settings?.weekly_profit_goal_cents ?? 300000));
  const [weeklyOwnerGoal, setWeeklyOwnerGoal] = useState(dollars(settings?.weekly_owner_goal_cents ?? 270000));
  const [weeklyReserveGoal, setWeeklyReserveGoal] = useState(dollars(settings?.weekly_reserve_goal_cents ?? 30000));
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
      additionalLocation: dollars(starter.additionalLocationCostCents),
      packaging: dollars(starter.packagingCostCents),
      minimumProfit: dollars(starter.minimumProfitPerItemCents),
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
          additionalLocationCostCents: cents(row.additionalLocation),
          packagingCostCents: cents(row.packaging),
          minimumProfitPerItemCents: cents(row.minimumProfit),
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
          margin1to9BasisPoints: Math.round((Number(margin1to9) || 0) * 100),
          margin10to24BasisPoints: Math.round((Number(margin10to24) || 0) * 100),
          margin25to49BasisPoints: Math.round((Number(margin25to49) || 0) * 100),
          margin50plusBasisPoints: Math.round((Number(margin50plus) || 0) * 100),
          minimumMarginFloorBasisPoints: Math.round((Number(minimumMarginFloor) || 0) * 100),
          standardShirtMinProfitCents: cents(standardShirtProfit),
          outsourcedMinMarginBasisPoints: Math.round((Number(outsourcedMargin) || 0) * 100),
          overheadBasisPoints: Math.round((Number(overheadPercent) || 0) * 100),
          paymentFeeBasisPoints: Math.round((Number(paymentFeePercent) || 0) * 100),
          paymentFeeFixedCents: cents(paymentFeeFixed),
          defaultShippingChargeCents: cents(defaultShippingCharge),
          incomeTaxReserveBasisPoints: Math.round((Number(incomeTaxReservePercent) || 0) * 100),
          laborWarningMinutesPerPiece: Math.max(0, Number(laborMinutesPerPiece) || 0),
          weeklySalesGoalCents: cents(weeklySalesGoal),
          weeklyProfitGoalCents: cents(weeklyProfitGoal),
          weeklyOwnerGoalCents: cents(weeklyOwnerGoal),
          weeklyReserveGoalCents: cents(weeklyReserveGoal),
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

  if (!ready) return <section className="adminWorkspacePanel"><div className="formError">Products & pricing need the latest database updates. Run Phase 6.26 if it has never been installed, then Phase 6.46 and <code>supabase/moore_made_phase6_47_profitability_reorder_goals.sql</code>.</div></section>;

  return (
    <section className="adminWorkspacePanel productPricingAdmin">
      <div className="adminSectionIntro"><div><div className="eyebrow">Private pricing engine</div><h2>Products & pricing</h2><p>Unsaved products begin with editable starter estimates. Replace them with your actual blank, transfer, and packaging costs as you receive invoices. Labor is added once to the entire quote, never once per product or item; nothing here appears as a public Shop price.</p></div></div>

      {message ? <div className="formSuccess">{message}</div> : null}
      {error ? <div className="formError">{error}</div> : null}

      <div className="pricingSettingsCard card">
        <div className="pricingSettingsHead"><div><strong>Profit, labor & weekly-goal safeguards</strong><span>Private defaults used to calculate a profitable starting quote and warn before undercharging.</span></div><span className="badge">Admin only</span></div>
        <div className="pricingSettingsGrid">
          <label className="field"><span>Internal labor rate per person-hour</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.25" value={globalLaborRate} onChange={(e) => setGlobalLaborRate(e.target.value)} /></div><small>Starts at $25/hour. Sal 2 hr + Matt 2 hr = 4 total person-hours.</small></label>
          <label className="field"><span>Minimum labor for the entire order</span><input type="number" min="1" step="0.25" value={minimumLaborHours} onChange={(e) => setMinimumLaborHours(e.target.value)} /><small>Applied once to the whole order—not once per product or line.</small></label>
          <label className="field"><span>Labor warning minutes per piece</span><input type="number" min="0" step="0.5" value={laborMinutesPerPiece} onChange={(e) => setLaborMinutesPerPiece(e.target.value)} /><small>Warns when entered person-hours appear unusually low.</small></label>
          <label className="field"><span>Overhead reserve</span><div className="percentInput"><input type="number" min="0" max="50" step="0.5" value={overheadPercent} onChange={(e) => setOverheadPercent(e.target.value)} /><span>%</span></div><small>Software, wear, misprints, ads, insurance, and bookkeeping.</small></label>
          <label className="field"><span>Payment fee rate</span><div className="percentInput"><input type="number" min="0" max="20" step="0.01" value={paymentFeePercent} onChange={(e) => setPaymentFeePercent(e.target.value)} /><span>%</span></div></label>
          <label className="field"><span>Payment fee fixed amount</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={paymentFeeFixed} onChange={(e) => setPaymentFeeFixed(e.target.value)} /></div><small>Applied per payment; deposit orders estimate two payments.</small></label>
          <label className="field"><span>Default customer shipping charge</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={defaultShippingCharge} onChange={(e) => setDefaultShippingCharge(e.target.value)} /></div><small>Auto-fills only when the customer chose Shipping. You can still override it on any quote.</small></label>
          <label className="field"><span>Owner income-tax reserve estimate</span><div className="percentInput"><input type="number" min="0" max="60" step="1" value={incomeTaxReservePercent} onChange={(e) => setIncomeTaxReservePercent(e.target.value)} /><span>%</span></div><small>Private planning reserve applied to estimated year-to-date taxable profit. Starts at 30%; your CPA can adjust it.</small></label>
        </div>
        <details className="pricingSafeguardSettings" open><summary>Quantity margins and minimum profit</summary><div className="pricingSettingsGrid">
          <label className="field"><span>1–9 piece target margin</span><div className="percentInput"><input type="number" min="0" max="95" value={margin1to9} onChange={(e) => setMargin1to9(e.target.value)} /><span>%</span></div></label>
          <label className="field"><span>10–24 piece target margin</span><div className="percentInput"><input type="number" min="0" max="95" value={margin10to24} onChange={(e) => setMargin10to24(e.target.value)} /><span>%</span></div></label>
          <label className="field"><span>25–49 piece target margin</span><div className="percentInput"><input type="number" min="0" max="95" value={margin25to49} onChange={(e) => setMargin25to49(e.target.value)} /><span>%</span></div></label>
          <label className="field"><span>50+ piece target margin</span><div className="percentInput"><input type="number" min="0" max="95" value={margin50plus} onChange={(e) => setMargin50plus(e.target.value)} /><span>%</span></div></label>
          <label className="field"><span>Absolute margin warning floor</span><div className="percentInput"><input type="number" min="0" max="95" value={minimumMarginFloor} onChange={(e) => setMinimumMarginFloor(e.target.value)} /><span>%</span></div></label>
          <label className="field"><span>Standard T-shirt minimum profit each (1–9)</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.25" value={standardShirtProfit} onChange={(e) => setStandardShirtProfit(e.target.value)} /></div><small>Bulk automatically tapers to $10 (10–24), $8 (25–49), and $6.50 (50+) while margin floors still apply.</small></label>
          <label className="field"><span>Outsourced-order minimum margin</span><div className="percentInput"><input type="number" min="0" max="95" value={outsourcedMargin} onChange={(e) => setOutsourcedMargin(e.target.value)} /><span>%</span></div></label>
        </div></details>
        <details className="pricingSafeguardSettings"><summary>Weekly income goals</summary><div className="pricingSettingsGrid">
          <label className="field"><span>Weekly sales goal</span><div className="moneyInput"><span>$</span><input type="number" min="1" step="50" value={weeklySalesGoal} onChange={(e) => setWeeklySalesGoal(e.target.value)} /></div></label>
          <label className="field"><span>Weekly business-profit goal</span><div className="moneyInput"><span>$</span><input type="number" min="1" step="50" value={weeklyProfitGoal} onChange={(e) => setWeeklyProfitGoal(e.target.value)} /></div></label>
          <label className="field"><span>Combined owner goal</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="50" value={weeklyOwnerGoal} onChange={(e) => setWeeklyOwnerGoal(e.target.value)} /></div><small>Before Sal and Matt’s personal tax reserves.</small></label>
          <label className="field"><span>Weekly business reserve</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="25" value={weeklyReserveGoal} onChange={(e) => setWeeklyReserveGoal(e.target.value)} /></div></label>
        </div></details>
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
                <label><span>Each additional location</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={row.additionalLocation} onChange={(e) => patch(product.slug, { additionalLocation: e.target.value })} /></div></label>
                <label><span>Packaging each</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.01" value={row.packaging} onChange={(e) => patch(product.slug, { packaging: e.target.value })} /></div></label>
                <label><span>Minimum profit each</span><div className="moneyInput"><span>$</span><input type="number" min="0" step="0.25" value={row.minimumProfit} onChange={(e) => patch(product.slug, { minimumProfit: e.target.value })} /></div></label>
                <label><span>Product baseline margin <small>Reference</small></span><div className="percentInput"><input type="number" min="0" max="95" step="1" value={row.margin} onChange={(e) => patch(product.slug, { margin: e.target.value })} /><span>%</span></div></label>
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
