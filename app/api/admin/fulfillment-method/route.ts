import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

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

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const id = text(body.id, 100);
    const mode = modeFrom(body.mode);
    if (!id || !mode) return NextResponse.json({ error: "Choose Local pickup, Local delivery, or Shipping." }, { status: 400 });

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
      .update({ delivery })
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
