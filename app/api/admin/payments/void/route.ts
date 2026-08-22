import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { recalculateOrderPayment } from "@/lib/payment-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const paymentId = String(body.paymentId || "").trim();
    const reason = String(body.reason || "").trim().slice(0, 1000);
    if (!paymentId || !reason) return NextResponse.json({ error: "Choose a payment and enter the correction reason." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: payment, error } = await supabase
      .from("payments")
      .select("id,request_id,quote_id,status,payment_method,amount_cents")
      .eq("id", paymentId)
      .single();
    if (error || !payment) return NextResponse.json({ error: "Payment not found." }, { status: 404 });
    if (payment.status !== "paid") return NextResponse.json({ error: "Only a currently paid record can be corrected this way." }, { status: 409 });
    if (payment.payment_method === "stripe") return NextResponse.json({ error: "A real Stripe charge cannot be voided only in Moore Made. Refund/correct it through Stripe first." }, { status: 409 });

    const { error: updateError } = await supabase.from("payments").update({
      status: "voided",
      voided_at: new Date().toISOString(),
      void_reason: reason,
      voided_by: auth.user.id,
    }).eq("id", paymentId).eq("status", "paid");
    if (updateError) throw updateError;

    const summary = await recalculateOrderPayment(payment.request_id, payment.quote_id);
    if (payment.payment_method === "cash") {
      await supabase.from("custom_requests").update({
        cash_payment_request_status: "cancelled",
        cash_payment_requested_at: null,
        cash_payment_requested_amount_cents: null,
        cash_payment_contacted_at: null,
      }).eq("id", payment.request_id);
    }
    return NextResponse.json({ ok: true, summary, message: `The ${Math.round(Number(payment.amount_cents || 0)) / 100} payment record was voided and the order balance was reopened for the correct payment method.` });
  } catch (error) {
    console.error("Payment correction failed", error);
    return NextResponse.json({ error: "Could not correct this payment record." }, { status: 500 });
  }
}
