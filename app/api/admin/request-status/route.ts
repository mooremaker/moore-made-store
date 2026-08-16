import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { REQUEST_STATUSES } from "@/lib/custom-request-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json();
  const id = typeof body.id === "string" ? body.id : "";
  const status = typeof body.status === "string" ? body.status : "";

  if (!id || !REQUEST_STATUSES.includes(status as (typeof REQUEST_STATUSES)[number])) {
    return NextResponse.json({ error: "Invalid status update." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: current, error: currentError } = await supabase.from("custom_requests").select("payment_status").eq("id", id).single();
  if (currentError || !current) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (status === "in_production" && current.payment_status === "unpaid") {
    return NextResponse.json({ error: "Required payment must be received before production begins." }, { status: 409 });
  }
  if (["ready", "shipped", "completed"].includes(status) && current.payment_status !== "paid") {
    return NextResponse.json({ error: "This order must be paid in full before final fulfillment." }, { status: 409 });
  }
  const { error } = await supabase.from("custom_requests").update({ status }).eq("id", id);

  if (error) {
    console.error("Admin status update failed", error);
    return NextResponse.json({ error: "Could not update this request." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
