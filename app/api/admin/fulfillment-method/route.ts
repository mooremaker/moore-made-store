import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { ShippingAddress } from "@/lib/order-types";

type FulfillmentMode = "pickup" | "delivery" | "shipping";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function modeFrom(value: unknown): FulfillmentMode | "" {
  if (value === "pickup") return "pickup";
  if (value === "delivery") return "delivery";
  if (value === "shipping" || value === "shipped") return "shipping";
  return "";
}

function deliveryLabel(mode: FulfillmentMode) {
  if (mode === "shipping") return "Shipping";
  if (mode === "delivery") return "Local delivery";
  return "Local pickup";
}

function normalizeAddress(value: unknown): ShippingAddress | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const address: ShippingAddress = {
    name: text(row.name, 200),
    line1: text(row.line1, 300),
    line2: text(row.line2, 300),
    city: text(row.city, 200),
    state: text(row.state, 100).toUpperCase(),
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
    const id = text(body.id, 100);
    const mode = modeFrom(body.mode);
    if (!id || !mode) return NextResponse.json({ error: "Choose Local pickup, Local delivery, or Shipping." }, { status: 400 });
    const shippingAddress = normalizeAddress(body.shippingAddress);
    if ((mode === "shipping" || mode === "delivery") && !shippingAddress) {
      return NextResponse.json({ error: `Complete the ${mode === "shipping" ? "shipping" : "local delivery"} address before saving.` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: order, error } = await supabase
      .from("custom_requests")
      .select("id,status")
      .eq("id", id)
      .single();

    if (error || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (order.status === "shipped" || order.status === "completed") {
      return NextResponse.json({ error: "The fulfillment method is locked after an order is shipped or completed." }, { status: 409 });
    }

    const delivery = deliveryLabel(mode);
    const { error: updateError } = await supabase
      .from("custom_requests")
      .update({ delivery, ...(shippingAddress ? { shipping_address: shippingAddress } : {}) })
      .eq("id", id);

    if (updateError) {
      console.error("Fulfillment method update failed", updateError);
      return NextResponse.json({ error: "Could not save the fulfillment method." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, delivery });
  } catch (error) {
    console.error("Fulfillment method update failed", error);
    return NextResponse.json({ error: "Could not save the fulfillment method." }, { status: 500 });
  }
}
