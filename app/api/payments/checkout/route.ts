import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { nextPaymentAmount, type PaymentTerms } from "@/lib/payment-types";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { siteUrl } from "@/lib/email";
import { FINAL_SALE_POLICY_VERSION } from "@/lib/payment-policy";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  try {
    if (!isStripeConfigured()) return NextResponse.json({ error: "Online payments are not configured yet." }, { status: 503 });
    const body = await request.json();
    const token = text(body.token, 100);
    if (!token) return NextResponse.json({ error: "Payment link is invalid." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select("id,request_id,public_token,status,total_cents,payment_terms,deposit_amount_cents,proof_version,custom_requests(id,request_number,customer_name,email,product,payment_status,amount_paid_cents)")
      .eq("public_token", token)
      .single();
    if (quoteError || !quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    if (quote.status !== "approved") return NextResponse.json({ error: "Approve the proof + quote before paying." }, { status: 409 });

    const requestRow = Array.isArray(quote.custom_requests) ? quote.custom_requests[0] : quote.custom_requests;
    if (!requestRow) return NextResponse.json({ error: "Order details are unavailable." }, { status: 500 });

    const { data: policyAcceptance, error: policyError } = await supabase
      .from("order_policy_acceptances")
      .select("id")
      .eq("quote_id", quote.id)
      .eq("proof_version", Math.max(1, Number(quote.proof_version || 1)))
      .eq("policy_version", FINAL_SALE_POLICY_VERSION)
      .maybeSingle();
    if (policyError || !policyAcceptance) {
      return NextResponse.json({ error: "Accept the final-sale custom-order terms before paying." }, { status: 409 });
    }

    const { data: paidRows } = await supabase.from("payments").select("amount_cents,status").eq("quote_id", quote.id);
    const amountPaid = (paidRows ?? []).filter((row) => row.status === "paid").reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
    const terms = (quote.payment_terms === "deposit" ? "deposit" : "full") as PaymentTerms;
    const next = nextPaymentAmount({
      totalCents: Number(quote.total_cents || 0),
      terms,
      depositAmountCents: quote.deposit_amount_cents,
      amountPaidCents: amountPaid,
    });
    if (!next.kind || next.amountCents <= 0) return NextResponse.json({ error: "This order is already paid in full." }, { status: 409 });

    const paymentId = randomUUID();
    const stripe = getStripe();
    const reference = formatRequestNumber(requestRow.request_number);
    const paymentName = next.kind === "deposit" ? `${reference} custom deposit` : next.kind === "balance" ? `${reference} remaining balance` : `${reference} full payment`;
    const baseUrl = siteUrl();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: requestRow.email,
      client_reference_id: reference,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: next.amountCents,
          product_data: {
            name: paymentName,
            description: requestRow.product,
          },
        },
      }],
      success_url: `${baseUrl}/quote/${token}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/quote/${token}?payment=cancelled`,
      metadata: {
        payment_id: paymentId,
        request_id: quote.request_id,
        quote_id: quote.id,
        request_number: reference,
        payment_kind: next.kind,
      },
      payment_intent_data: {
        metadata: {
          payment_id: paymentId,
          request_id: quote.request_id,
          quote_id: quote.id,
          request_number: reference,
          payment_kind: next.kind,
        },
      },
    });

    const { error: insertError } = await supabase.from("payments").insert({
      id: paymentId,
      request_id: quote.request_id,
      quote_id: quote.id,
      payment_kind: next.kind,
      amount_cents: next.amountCents,
      currency: "usd",
      status: "pending",
      stripe_checkout_session_id: session.id,
    });
    if (insertError) {
      console.error("Payment record creation failed", insertError);
      return NextResponse.json({ error: "Could not prepare this payment." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    console.error("Stripe checkout creation failed", error);
    return NextResponse.json({ error: "Could not open secure checkout." }, { status: 500 });
  }
}
