import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { retrieveStripeSettlement } from "@/lib/stripe-settlement";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const paymentId = text(body.paymentId, 100);
    const supabase = getSupabaseAdmin();
    const { data: payment, error } = await supabase
      .from("payments")
      .select("id,status,payment_method,stripe_payment_intent_id")
      .eq("id", paymentId)
      .single();
    if (error || !payment) return NextResponse.json({ error: "Payment not found." }, { status: 404 });
    if (payment.status !== "paid" || payment.payment_method !== "stripe" || !payment.stripe_payment_intent_id) {
      return NextResponse.json({ error: "Only completed Stripe payments can be reconciled." }, { status: 409 });
    }

    const settlement = await retrieveStripeSettlement(payment.stripe_payment_intent_id);
    if (!settlement) return NextResponse.json({ error: "Stripe has not made the settlement details available yet. Try again shortly." }, { status: 409 });

    const { error: updateError } = await supabase.from("payments").update({
      stripe_fee_cents: settlement.feeCents,
      stripe_net_cents: settlement.netCents,
      stripe_balance_transaction_id: settlement.balanceTransactionId,
    }).eq("id", payment.id);
    if (updateError) throw new Error("Could not save the Stripe settlement details.");

    return NextResponse.json({ ok: true, feeCents: settlement.feeCents, netCents: settlement.netCents });
  } catch (error) {
    console.error("Stripe settlement reconciliation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not reconcile this Stripe payment." }, { status: 500 });
  }
}
