import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { ShippingAddress } from "@/lib/order-types";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeAddress(value: unknown): ShippingAddress | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const address: ShippingAddress = {
    name: text(row.name, 200), line1: text(row.line1, 300), line2: text(row.line2, 300), city: text(row.city, 200), state: text(row.state, 100), postalCode: text(row.postalCode ?? row.postal_code, 30), country: (text(row.country, 2) || "US").toUpperCase(),
  };
  return address.line1 && address.city && address.state && address.postalCode && address.country ? address : null;
}

export async function calculateAutomaticOrderTax({ requestId, merchandiseCents, shippingCents, taxCode, inputFingerprint }: { requestId: string; merchandiseCents: number; shippingCents: number; taxCode?: string | null; inputFingerprint?: string | null }) {
  const supabase = getSupabaseAdmin();
  const [{ data: order, error: orderError }, { data: settings }] = await Promise.all([
    supabase.from("custom_requests").select("id,delivery,shipping_address").eq("id", requestId).single(),
    supabase.from("business_settings").select("pickup_address,default_tax_code,shipping_tax_code").eq("id", "default").maybeSingle(),
  ]);
  if (orderError || !order) throw new Error("Order not found.");

  const fulfillment = String(order.delivery || "").trim().toLowerCase();
  const isShipping = fulfillment.includes("ship");
  const isDelivery = fulfillment.includes("delivery") && !isShipping;
  const isPickup = fulfillment.includes("pickup");
  const destination = normalizeAddress(order.shipping_address);
  const pickup = normalizeAddress(settings?.pickup_address);
  const address = isShipping || isDelivery ? destination : isPickup ? pickup : null;
  if (!address) {
    if (isShipping) throw new Error("This order needs a complete shipping address before automatic tax can be calculated.");
    if (isDelivery) throw new Error("This order needs a complete local delivery address before automatic tax can be calculated.");
    if (isPickup) throw new Error("Add Moore Made's pickup/business address under Admin → Products & pricing before calculating pickup tax.");
    throw new Error("Choose Local pickup, Local delivery, or Shipping before calculating automatic sales tax.");
  }

  const stripe = getStripe();
  const calculation = await stripe.tax.calculations.create({
    currency: "usd",
    customer_details: { address: { line1: address.line1, line2: address.line2 || undefined, city: address.city, state: address.state, postal_code: address.postalCode, country: address.country }, address_source: "shipping" },
    line_items: merchandiseCents > 0 ? [{ amount: merchandiseCents, reference: `order-${requestId}`, tax_behavior: "exclusive", tax_code: taxCode || settings?.default_tax_code || "txcd_99999999" }] : [],
    ...(shippingCents > 0 ? { shipping_cost: { amount: shippingCents, tax_behavior: "exclusive", tax_code: settings?.shipping_tax_code || "txcd_92010001" } } : {}),
    expand: ["line_items"],
  } as any);
  const taxCents = Math.max(0, Number((calculation as any).tax_amount_exclusive || 0) + Number((calculation as any).tax_amount_inclusive || 0));
  return {
    calculationId: String(calculation.id || ""),
    taxCents,
    calculatedAt: new Date().toISOString(),
    inputFingerprint: inputFingerprint || "",
    location: { city: address.city, state: address.state, postalCode: address.postalCode, country: address.country, source: isShipping ? "shipping" : isDelivery ? "delivery" : "pickup" },
    breakdown: { taxAmountExclusive: Number((calculation as any).tax_amount_exclusive || 0), taxAmountInclusive: Number((calculation as any).tax_amount_inclusive || 0), amountTotal: Number((calculation as any).amount_total || merchandiseCents + shippingCents + taxCents) },
  };
}
