import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const requestId = String(body.requestId || "");
    const status = String(body.status || "");
    if (!requestId) return NextResponse.json({ error: "Order is required." }, { status: 400 });
    if (!new Set(["contacted", "cancelled"]).has(status)) return NextResponse.json({ error: "Invalid cash request status." }, { status: 400 });

    const update: Record<string, string | null> = { cash_payment_request_status: status };
    if (status === "contacted") update.cash_payment_contacted_at = new Date().toISOString();
    if (status === "cancelled") update.cash_payment_contacted_at = null;

    const { error } = await getSupabaseAdmin().from("custom_requests").update(update).eq("id", requestId);
    if (error) {
      console.error("Cash request admin update failed", error);
      return NextResponse.json({ error: "Could not update the cash payment request." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Cash request admin route failed", error);
    return NextResponse.json({ error: "Could not update the cash payment request." }, { status: 500 });
  }
}
