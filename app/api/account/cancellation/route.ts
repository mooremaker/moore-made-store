import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  try {
    const body = await request.json();
    if (typeof body.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.requestId) || typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.length > 2000 || body.confirmed !== true) {
      return NextResponse.json({ error: "Add a reason and confirm your cancellation choice." }, { status: 400 });
    }
    const { data, error } = await getSupabaseAdmin().rpc("customer_cancel_order", { p_request_id: body.requestId, p_customer_id: user.id, p_reason: body.reason.trim() });
    if (error) {
      const missing = error.code === "PGRST202" || error.code === "42883";
      return NextResponse.json({ error: missing ? "Cancellation is not available yet. Please message Moore Made." : error.code === "42501" ? "Order not available to this account." : "Could not record cancellation. Refresh the order or contact Moore Made." }, { status: missing ? 503 : error.code === "42501" ? 403 : 409 });
    }
    return NextResponse.json(data);
  } catch { return NextResponse.json({ error: "Could not record cancellation. Please try again." }, { status: 500 }); }
}
