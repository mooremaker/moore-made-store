import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { nextPaymentAmount, type PaymentTerms } from "@/lib/payment-types";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { siteUrl } from "@/lib/email";
import { FINAL_SALE_POLICY_VERSION } from "@/lib/payment-policy";
import { recordPaidCheckoutSession } from "@/lib/payment-server";
import { hashPaymentShareToken } from "@/lib/payment-share";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

type PendingPayment = {
  id: string;
  amount_cents: number;
  payment_kind: "full" | "deposit" | "balance";
  stripe_checkout_session_id: string | null;
  payer_email: string | null;
};

async function reuseOpenCheckoutSession({
  quoteId,
  amountCents,
  paymentKind,
  payerEmail,
}: {
  quoteId: string;
  amountCents: number;
  paymentKind: "full" | "deposit" | "balance";
  payerEmail?: string | null;
}) {
  const supabase = getSupabaseAdmin();
  const stripe = getStripe();
  const { data } = await supabase
    .from("payments")
    .select("id,amount_cents,payment_kind,stripe_checkout_session_id,payer_email")
    .eq("quote_id", quoteId)
    .eq("status", "pending")
    .eq("amount_cents", amountCents)
    .eq("payment_kind", paymentKind)
    .order("created_at", { ascending: false })
    .limit(5);

  for (const row of (data ?? []) as PendingPayment[]) {
    if (payerEmail && (row.payer_email || "").toLowerCase() !== payerEmail.toLowerCase()) continue;
    if (!payerEmail && row.payer_email) continue;
    if (!row.stripe_checkout_session_id) continue;
    try {
      const session = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id);
      if (session.status === "open" && session.url) return session.url;
      if (session.payment_status === "paid") {
        await recordPaidCheckoutSession(session);
        continue;
      }
      if (session.status === "expired" || session.status === "complete") {
        await supabase.from("payments").update({ status: "failed" }).eq("id", row.id).eq("status", "pending");
      }
    } catch (error) {
      console.error("Existing Stripe checkout lookup failed", error);
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "Online payments are not configured yet." }, { status: 503 });
    }

    const body = await request.json();
    const token = text(body.token, 140);
    const shareToken = text(body.shareToken, 200);
    const payerName = text(body.payerName, 160);
    const payerEmail = text(body.payerEmail, 320).toLowerCase();
    if (!token && !shareToken) return NextResponse.json({ error: "Payment link is invalid." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    let shareLinkId: string | null = null;
    let quoteIdFromShare: string | null = null;
    if (shareToken) {
      const { data: shareLink, error: shareError } = await supabase
        .from("payment_share_links")
        .select("id,quote_id,active,revoked_at,expires_at")
        .eq("token_hash", hashPaymentShareToken(shareToken))
        .maybeSingle();
      if (shareError || !shareLink || !shareLink.active || shareLink.revoked_at || (shareLink.expires_at && new Date(shareLink.expires_at).getTime() < Date.now())) {
        return NextResponse.json({ error: "This shared payment link is no longer active." }, { status: 404 });
      }
      if (!payerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
        return NextResponse.json({ error: "Enter the payer name and a valid payer email." }, { status: 400 });
      }
      shareLinkId = shareLink.id;
      quoteIdFromShare = shareLink.quote_id;
    }

    let quoteQuery = supabase
      .from("quotes")
      .select("id,request_id,public_token,status,total_cents,payment_terms,deposit_amount_cents,proof_version,revision_number,custom_requests(id,request_number,customer_name,email,product,payment_status,amount_paid_cents)");
    quoteQuery = quoteIdFromShare ? quoteQuery.eq("id", quoteIdFromShare) : quoteQuery.eq("public_token", token);
    const { data: quote, error: quoteError } = await quoteQuery.single();

    if (quoteError || !quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    if (quote.status !== "approved") {
      return NextResponse.json({ error: "Approve the proof + quote before paying." }, { status: 409 });
    }

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

    const { data: paidRows } = await supabase
      .from("payments")
      .select("amount_cents,status")
      .eq("quote_id", quote.id);

    const amountPaid = (paidRows ?? [])
      .filter((row) => row.status === "paid")
      .reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);

    const terms = (quote.payment_terms === "deposit" ? "deposit" : "full") as PaymentTerms;
    const next = nextPaymentAmount({
      totalCents: Number(quote.total_cents || 0),
      terms,
      depositAmountCents: quote.deposit_amount_cents,
      amountPaidCents: amountPaid,
    });

    if (!next.kind || next.amountCents <= 0) {
      return NextResponse.json({ error: "This order is already paid in full." }, { status: 409 });
    }

    const existingUrl = await reuseOpenCheckoutSession({
      quoteId: quote.id,
      amountCents: next.amountCents,
      paymentKind: next.kind,
      payerEmail: shareToken ? payerEmail : null,
    });
    if (existingUrl) return NextResponse.json({ ok: true, url: existingUrl, reused: true });

    const paymentId = randomUUID();
    const stripe = getStripe();
    const reference = formatRequestNumber(requestRow.request_number);
    const paymentName = next.kind === "deposit"
      ? `${reference} custom deposit`
      : next.kind === "balance"
        ? `${reference} remaining balance`
        : `${reference} full payment`;
    const baseUrl = siteUrl();
    const returnBase = shareToken ? `${baseUrl}/pay/${shareToken}` : `${baseUrl}/quote/${token}`;

    const { error: insertError } = await supabase.from("payments").insert({
      id: paymentId,
      request_id: quote.request_id,
      quote_id: quote.id,
      payment_kind: next.kind,
      amount_cents: next.amountCents,
      currency: "usd",
      status: "pending",
      payer_name: shareToken ? payerName : null,
      payer_email: shareToken ? payerEmail : null,
      payment_share_link_id: shareLinkId,
    });

    if (insertError) {
      console.error("Payment record creation failed", insertError);
      return NextResponse.json({ error: "Could not prepare this payment." }, { status: 500 });
    }

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: shareToken ? payerEmail : requestRow.email,
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
        success_url: `${returnBase}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnBase}?payment=cancelled`,
        metadata: {
          payment_id: paymentId,
          request_id: quote.request_id,
          quote_id: quote.id,
          request_number: reference,
          payment_kind: next.kind,
          quote_revision: String(Math.max(1, Number(quote.revision_number || 1))),
          payer_name: shareToken ? payerName : requestRow.customer_name,
          payer_email: shareToken ? payerEmail : requestRow.email,
          payment_share_link_id: shareLinkId || "",
        },
        payment_intent_data: {
          metadata: {
            payment_id: paymentId,
            request_id: quote.request_id,
            quote_id: quote.id,
            request_number: reference,
            payment_kind: next.kind,
            quote_revision: String(Math.max(1, Number(quote.revision_number || 1))),
            payer_name: shareToken ? payerName : requestRow.customer_name,
            payer_email: shareToken ? payerEmail : requestRow.email,
            payment_share_link_id: shareLinkId || "",
          },
        },
      }, {
        idempotencyKey: `moore-made-payment-${paymentId}`,
      });

      const { error: updateError } = await supabase
        .from("payments")
        .update({ stripe_checkout_session_id: session.id })
        .eq("id", paymentId);

      if (updateError) {
        console.error("Stripe checkout session save failed", updateError);
        try {
          if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
        } catch (expireError) {
          console.error("Could not expire orphaned Stripe checkout session", expireError);
        }
        await supabase.from("payments").update({ status: "failed" }).eq("id", paymentId);
        return NextResponse.json({ error: "Could not prepare this payment." }, { status: 500 });
      }

      return NextResponse.json({ ok: true, url: session.url });
    } catch (stripeError) {
      await supabase.from("payments").update({ status: "failed" }).eq("id", paymentId);
      throw stripeError;
    }
  } catch (error) {
    console.error("Stripe checkout creation failed", error);
    return NextResponse.json({ error: "Could not open secure checkout." }, { status: 500 });
  }
}
