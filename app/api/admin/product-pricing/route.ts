import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cents(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function number(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function centsMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, amount]) => [text(key, 40), cents(amount)] as const)
    .filter(([key]) => Boolean(key)));
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();

    if (body.kind === "settings") {
      const pickup = body.pickupAddress && typeof body.pickupAddress === "object" ? body.pickupAddress as Record<string, unknown> : {};
      const pickupAddress = {
        name: text(pickup.name, 160),
        line1: text(pickup.line1, 300),
        line2: text(pickup.line2, 300),
        city: text(pickup.city, 160),
        state: text(pickup.state, 80),
        postalCode: text(pickup.postalCode, 40),
        country: text(pickup.country, 2).toUpperCase() || "US",
      };
      const { error } = await supabase.from("business_settings").upsert({
        id: "default",
        default_labor_rate_cents: cents(body.defaultLaborRateCents),
        minimum_labor_hours: Math.max(1, number(body.minimumLaborHours, 1)),
        margin_1_9_basis_points: Math.min(9500, cents(body.margin1to9BasisPoints)),
        margin_10_24_basis_points: Math.min(9500, cents(body.margin10to24BasisPoints)),
        margin_25_49_basis_points: Math.min(9500, cents(body.margin25to49BasisPoints)),
        margin_50_plus_basis_points: Math.min(9500, cents(body.margin50plusBasisPoints)),
        minimum_margin_floor_basis_points: Math.min(9500, cents(body.minimumMarginFloorBasisPoints)),
        standard_shirt_min_profit_cents: cents(body.standardShirtMinProfitCents),
        outsourced_min_margin_basis_points: Math.min(9500, cents(body.outsourcedMinMarginBasisPoints)),
        overhead_basis_points: Math.min(5000, cents(body.overheadBasisPoints)),
        payment_fee_basis_points: Math.min(2000, cents(body.paymentFeeBasisPoints)),
        payment_fee_fixed_cents: cents(body.paymentFeeFixedCents),
        default_shipping_charge_cents: cents(body.defaultShippingChargeCents),
        income_tax_reserve_basis_points: Math.min(6000, cents(body.incomeTaxReserveBasisPoints)),
        labor_warning_minutes_per_piece: Math.max(0, number(body.laborWarningMinutesPerPiece, 3)),
        weekly_sales_goal_cents: Math.max(1, cents(body.weeklySalesGoalCents)),
        weekly_profit_goal_cents: Math.max(1, cents(body.weeklyProfitGoalCents)),
        weekly_owner_goal_cents: cents(body.weeklyOwnerGoalCents),
        weekly_reserve_goal_cents: cents(body.weeklyReserveGoalCents),
        pickup_address: pickupAddress,
        default_tax_code: text(body.defaultTaxCode, 80) || "txcd_99999999",
        shipping_tax_code: text(body.shippingTaxCode, 80) || "txcd_92010001",
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    const slug = text(body.productSlug, 160);
    const name = text(body.productName, 300);
    if (!slug || !name) return NextResponse.json({ error: "Product is required." }, { status: 400 });

    const marginBasisPoints = Math.min(9500, Math.max(0, Math.round(number(body.targetMarginBasisPoints, 5000))));
    const { error } = await supabase.from("product_pricing").upsert({
      product_slug: slug,
      product_name: name,
      active: body.active !== false,
      blank_cost_cents: cents(body.blankCostCents),
      size_blank_costs: centsMap(body.sizeBlankCosts),
      size_customer_surcharges: centsMap(body.sizeCustomerSurcharges),
      print_cost_cents: cents(body.printCostCents),
      additional_location_cost_cents: cents(body.additionalLocationCostCents),
      packaging_cost_cents: cents(body.packagingCostCents),
      minimum_profit_per_item_cents: cents(body.minimumProfitPerItemCents),
      // These legacy product fields stay neutral. Labor is a business/order
      // setting and is added exactly once when the quote is calculated.
      default_labor_hours: 0,
      labor_rate_cents: cents(body.laborRateCents),
      target_margin_basis_points: marginBasisPoints,
      tax_code: text(body.taxCode, 80) || "txcd_99999999",
      notes: text(body.notes, 3000) || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "product_slug" });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Product pricing save failed", error);
    return NextResponse.json({ error: "Could not save pricing settings." }, { status: 500 });
  }
}
