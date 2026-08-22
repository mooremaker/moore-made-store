import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getStripe } from "@/lib/stripe";
import type { ShippingAddress } from "@/lib/order-types";

function cents(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeAddress(value: unknown): ShippingAddress | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const address: ShippingAddress = {
    name: text(row.name, 200),
    line1: text(row.line1, 300),
    line2: text(row.line2, 300),
    city: text(row.city, 200),
    state: text(row.state, 100),
    postalCode: text(row.postalCode ?? row.postal_code, 30),
    country: (text(row.country, 2) || "US").toUpperCase(),
  };
  if (!address.line1 || !address.city || !address.state || !address.postalCode || !address.country) return null;
  return address;
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const requestId = text(body.requestId, 100);
    const merchandiseCents = cents(body.merchandiseCents);
    const shippingCents = cents(body.shippingCents);
    const inputFingerprint = text(body.inputFingerprint, 5000);
    const requestedTaxCode = text(body.taxCode, 80);
    if (!requestId) return NextResponse.json({ error: "Order not found." }, { status: 400 });
    if (merchandiseCents <= 0 && shippingCents <= 0) {
      return NextResponse.json({ error: "Add a customer price before calculating sales tax." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const [{ data: order, error: orderError }, { data: settings }] = await Promise.all([
      supabase.from("custom_requests").select("id,delivery,shipping_address").eq("id", requestId).single(),
      supabase.from("business_settings").select("pickup_address,default_tax_code,shipping_tax_code").eq("id", "default").maybeSingle(),
    ]);
    if (orderError || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

    const delivery = String(order.delivery || "");
    const shippingAddress = normalizeAddress(order.shipping_address);
    const pickupAddress = normalizeAddress(settings?.pickup_address);
    const address = delivery === "Shipping" ? shippingAddress : delivery === "Local pickup" ? pickupAddress : null;

    if (!address) {
      if (delivery === "Shipping") {
        return NextResponse.json({ error: "This order needs a complete shipping address before automatic tax can be calculated." }, { status: 400 });
      }
      if (delivery === "Local pickup") {
        return NextResponse.json({ error: "Add Moore Made's pickup/business address under Admin → Products & pricing before calculating pickup tax." }, { status: 400 });
      }
      return NextResponse.json({ error: "Choose Shipping or Local pickup before calculating automatic sales tax." }, { status: 400 });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Stripe is not connected yet. Add STRIPE_SECRET_KEY to the server environment." }, { status: 503 });
    }

    const stripe = getStripe();
    const lineItems: Array<Record<string, unknown>> = [];
    if (merchandiseCents > 0) {
      lineItems.push({
        amount: merchandiseCents,
        reference: `order-${requestId}`,
        tax_behavior: "exclusive",
        tax_code: requestedTaxCode || settings?.default_tax_code || "txcd_99999999",
      });
    }

    const calculation = await stripe.tax.calculations.create({
      currency: "usd",
      customer_details: {
        address: {
          line1: address.line1,
          line2: address.line2 || undefined,
          city: address.city,
          state: address.state,
          postal_code: address.postalCode,
          country: address.country,
        },
        address_source: "shipping",
      },
      line_items: lineItems as any,
      ...(shippingCents > 0 ? {
        shipping_cost: {
          amount: shippingCents,
          tax_behavior: "exclusive",
          tax_code: settings?.shipping_tax_code || "txcd_92010001",
        },
      } : {}),
      expand: ["line_items"],
    } as any);

    const taxCents = Math.max(0, Number((calculation as any).tax_amount_exclusive || 0) + Number((calculation as any).tax_amount_inclusive || 0));
    return NextResponse.json({
      ok: true,
      calculationId: calculation.id,
      taxCents,
      calculatedAt: new Date().toISOString(),
      inputFingerprint,
      location: {
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country,
        source: delivery === "Shipping" ? "shipping" : "pickup",
      },
      breakdown: {
        taxAmountExclusive: Number((calculation as any).tax_amount_exclusive || 0),
        taxAmountInclusive: Number((calculation as any).tax_amount_inclusive || 0),
        amountTotal: Number((calculation as any).amount_total || merchandiseCents + shippingCents + taxCents),
      },
    });
  } catch (error) {
    console.error("Stripe Tax calculation failed", error);
    const message = error instanceof Error ? error.message : "Could not calculate sales tax.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
