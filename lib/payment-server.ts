import type Stripe from "stripe";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { emailShell, escapeHtml, publicSiteUrl, sendMooreMadeEmail } from "@/lib/email";
import { money } from "@/lib/quote-types";
import { quoteRequiredDeposit, type PaymentTerms } from "@/lib/payment-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { recordCustomerEmailNotification } from "@/lib/message-server";
import { retrieveStripeSettlement } from "@/lib/stripe-settlement";

export async function recalculateOrderPayment(requestId: string, quoteId: string) {
  const supabase = getSupabaseAdmin();
  const [{ data: quote }, { data: request }, { data: paymentRows }] = await Promise.all([
    supabase.from("quotes").select("id,public_token,total_cents,payment_terms,deposit_amount_cents,tax_mode,stripe_tax_calculation_id,stripe_tax_transaction_id").eq("id", quoteId).single(),
    supabase.from("custom_requests").select("id,status,request_number,customer_name,email,product").eq("id", requestId).single(),
    supabase.from("payments").select("amount_cents,status").eq("request_id", requestId),
  ]);

  if (!quote || !request) throw new Error("Payment order details are unavailable.");

  const amountPaidCents = (paymentRows ?? [])
    .filter((row) => row.status === "paid")
    .reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
  const totalCents = Math.max(0, Number(quote.total_cents || 0));
  const terms = (quote.payment_terms === "deposit" ? "deposit" : "full") as PaymentTerms;
  const depositRequired = quoteRequiredDeposit(totalCents, terms, quote.deposit_amount_cents);

  const paymentStatus = amountPaidCents >= totalCents
    ? "paid"
    : terms === "deposit" && amountPaidCents >= depositRequired
      ? "deposit_paid"
      : "unpaid";

  const mayStartProduction = paymentStatus === "paid" || paymentStatus === "deposit_paid";
  const nextStatus = mayStartProduction && request.status === "approved"
    ? "in_production"
    : paymentStatus === "unpaid" && request.status === "in_production"
      ? "approved"
      : request.status;

  const { error } = await supabase
    .from("custom_requests")
    .update({ payment_status: paymentStatus, amount_paid_cents: amountPaidCents, status: nextStatus })
    .eq("id", requestId);
  if (error) throw new Error("Could not update order payment status.");

  return {
    request,
    totalCents,
    terms,
    depositRequired,
    amountPaidCents,
    remainingCents: Math.max(0, totalCents - amountPaidCents),
    overpaidCents: Math.max(0, amountPaidCents - totalCents),
    paymentStatus,
    orderStatus: nextStatus,
    invoiceToken: quote.public_token || null,
    taxMode: quote.tax_mode || "manual",
    stripeTaxCalculationId: quote.stripe_tax_calculation_id || null,
    stripeTaxTransactionId: quote.stripe_tax_transaction_id || null,
  };
}

export async function markCheckoutSessionFailed(session: Stripe.Checkout.Session, reason = "failed") {
  const supabase = getSupabaseAdmin();
  const paymentId = session.metadata?.payment_id || "";

  if (paymentId) {
    const { error } = await supabase
      .from("payments")
      .update({ status: "failed", stripe_checkout_session_id: session.id })
      .eq("id", paymentId)
      .eq("status", "pending");
    if (error) console.error(`Could not mark Stripe payment ${reason}`, error);
    return;
  }

  const { error } = await supabase
    .from("payments")
    .update({ status: "failed" })
    .eq("stripe_checkout_session_id", session.id)
    .eq("status", "pending");
  if (error) console.error(`Could not mark Stripe payment ${reason}`, error);
}

/**
 * When an approved quote is revised, any old unpaid Checkout page should stop
 * accepting the stale amount. This expires open Stripe sessions and marks the
 * corresponding local pending attempts as failed. A new session is created
 * only after the customer approves the revised quote.
 */
export async function expirePendingCheckoutSessionsForQuote(quoteId: string) {
  if (!isStripeConfigured()) return;

  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from("payments")
    .select("id,stripe_checkout_session_id,status")
    .eq("quote_id", quoteId)
    .eq("status", "pending");

  if (error) {
    console.error("Pending Stripe payment lookup failed", error);
    return;
  }

  const stripe = getStripe();
  for (const row of rows ?? []) {
    const sessionId = row.stripe_checkout_session_id as string | null;
    try {
      if (sessionId) {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === "paid") {
          await recordPaidCheckoutSession(session);
          continue;
        }
        if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
      }
      await supabase.from("payments").update({ status: "failed" }).eq("id", row.id).eq("status", "pending");
    } catch (sessionError) {
      console.error("Could not expire stale Stripe checkout session", sessionError);
    }
  }
}

export async function recordPaidCheckoutSession(session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") return { ok: false as const, reason: "not_paid" as const };

  const paymentId = session.metadata?.payment_id || "";
  const requestId = session.metadata?.request_id || "";
  const quoteId = session.metadata?.quote_id || "";
  if (!paymentId || !requestId || !quoteId) throw new Error("Stripe payment metadata is incomplete.");

  const supabase = getSupabaseAdmin();
  const { data: existing, error: existingError } = await supabase
    .from("payments")
    .select("id,status,amount_cents,payment_kind,payer_name,payer_email")
    .eq("id", paymentId)
    .single();
  if (existingError || !existing) throw new Error("Payment record not found.");

  const wasAlreadyPaid = existing.status === "paid";
  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id || null;
  const amountReceived = Math.max(0, Number(session.amount_total ?? existing.amount_cents ?? 0));
  let settlement: Awaited<ReturnType<typeof retrieveStripeSettlement>> = null;
  if (paymentIntentId) {
    try {
      settlement = await retrieveStripeSettlement(paymentIntentId);
    } catch (settlementError) {
      console.error("Could not retrieve Stripe settlement fee", settlementError);
    }
  }

  if (amountReceived <= 0) throw new Error("Stripe reported a paid Checkout Session without an amount.");
  if (amountReceived !== Number(existing.amount_cents || 0)) {
    console.warn("Stripe payment amount differed from the local pending amount", {
      paymentId,
      expected: existing.amount_cents,
      received: amountReceived,
    });
  }

  const { error: paymentError } = await supabase
    .from("payments")
    .update({
      amount_cents: amountReceived,
      status: "paid",
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      stripe_fee_cents: settlement?.feeCents ?? null,
      stripe_net_cents: settlement?.netCents ?? null,
      stripe_balance_transaction_id: settlement?.balanceTransactionId ?? null,
      paid_at: new Date().toISOString(),
      payer_name: session.metadata?.payer_name || existing.payer_name || null,
      payer_email: session.metadata?.payer_email || existing.payer_email || null,
    })
    .eq("id", paymentId);
  if (paymentError) throw new Error("Could not record Stripe payment.");

  const summary = await recalculateOrderPayment(requestId, quoteId);
  if (summary.remainingCents <= 0 && summary.taxMode === "automatic" && summary.stripeTaxCalculationId && !summary.stripeTaxTransactionId) {
    try {
      const taxTransaction = await getStripe().tax.transactions.createFromCalculation(
        {
          calculation: summary.stripeTaxCalculationId,
          reference: `order-${requestId}`,
          metadata: { quote_id: quoteId, request_id: requestId, source: "payment_webhook" },
        },
        { idempotencyKey: `moore-made-tax-${quoteId}` },
      );
      await supabase.from("quotes").update({ stripe_tax_transaction_id: taxTransaction.id }).eq("id", quoteId).is("stripe_tax_transaction_id", null);
    } catch (taxTransactionError) {
      console.error("Final Stripe Tax transaction recording failed", taxTransactionError);
    }
  }
  const { data: receiptPayment } = await supabase
    .from("payments")
    .select("receipt_number,receipt_token,receipt_order_number,receipt_payment_sequence")
    .eq("id", paymentId)
    .single();

  if (!wasAlreadyPaid) {
    try {
      const reference = formatRequestNumber(summary.request.request_number);
      const customerReceiptEmail = await sendMooreMadeEmail({
        to: summary.request.email,
        subject: `Payment received — ${reference}`,
        html: emailShell(
          `Payment received — ${reference}`,
          `<p style="line-height:1.65;margin:0 0 16px;">Hi ${escapeHtml(summary.request.customer_name)}, we received a card payment of <strong>${escapeHtml(money(amountReceived))}</strong> for <strong>${escapeHtml(reference)}</strong>${session.metadata?.payer_name && session.metadata.payer_name !== summary.request.customer_name ? ` from <strong>${escapeHtml(session.metadata.payer_name)}</strong>` : ""}.</p>
           <div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:14px 16px;margin:0 0 18px;">
             <p style="margin:0 0 6px;"><strong>Order total:</strong> ${escapeHtml(money(summary.totalCents))}</p>
             <p style="margin:0 0 6px;"><strong>Paid to date:</strong> ${escapeHtml(money(summary.amountPaidCents))}</p>
             <p style="margin:0;"><strong>Remaining:</strong> ${escapeHtml(money(summary.remainingCents))}</p>
           </div>
           <p style="line-height:1.65;margin:0 0 18px;">${summary.remainingCents <= 0 ? "Your order is paid in full. We’ll keep you updated when it is ready for pickup or ships." : "Your payment has been applied to the order. Any remaining balance stays attached to your order."}</p>
           <p style="line-height:1.55;margin:0 0 18px;color:#6b6b6b;font-size:13px;"><strong>Custom order — all sales final.</strong> Deposits and payments are non-refundable.<br>If there is an issue with your finished order, contact Moore Made so we can help make it right.</p>
           <div style="display:flex;gap:10px;flex-wrap:wrap;">
             ${summary.invoiceToken ? `<a href="${publicSiteUrl()}/invoice/${summary.invoiceToken}" style="display:inline-block;background:#fff;color:#171717;border:1px solid #d7d1c8;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:800;">View invoice</a>` : ""}
             ${receiptPayment?.receipt_token ? `<a href="${publicSiteUrl()}/receipt/${receiptPayment.receipt_token}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:800;">View / print receipt</a>` : ""}
           </div>`
        ),
      });
      await supabase.from("notification_email_log").insert({ request_id: requestId, quote_id: quoteId, notification_type: "payment_receipt", recipient_email: summary.request.email, subject: `Payment received — ${reference}`, status: customerReceiptEmail.ok ? "sent" : "failed", provider_message_id: customerReceiptEmail.id || null, error_message: customerReceiptEmail.ok ? null : customerReceiptEmail.error || "Email could not be sent.", created_by: null, sent_at: new Date().toISOString() });
      if (customerReceiptEmail.ok) await recordCustomerEmailNotification({ requestId, recipientEmails: summary.request.email, subject: `Payment received — ${reference}`, body: `Payment received: ${money(amountReceived)}. Paid to date: ${money(summary.amountPaidCents)}. Remaining balance: ${money(summary.remainingCents)}.`, topic: "payment", label: "Payment receipt email sent" });
    } catch (customerEmailError) {
      console.error("Stripe customer receipt email failed", customerEmailError);
    }

    const payerReceiptEmail = (session.metadata?.payer_email || existing.payer_email || "").trim().toLowerCase();
    if (payerReceiptEmail && payerReceiptEmail !== summary.request.email.trim().toLowerCase()) {
      try {
        const reference = formatRequestNumber(summary.request.request_number);
        await sendMooreMadeEmail({
          to: payerReceiptEmail,
          subject: `Payment receipt — ${reference}`,
          html: emailShell(
            `Payment receipt — ${reference}`,
            `<p style="line-height:1.65;margin:0 0 16px;">Thanks — your card payment of <strong>${escapeHtml(money(amountReceived))}</strong> was applied to Moore Made order <strong>${escapeHtml(reference)}</strong> for <strong>${escapeHtml(summary.request.customer_name)}</strong>.</p>
             <p style="line-height:1.65;margin:0 0 18px;"><strong>Remaining order balance:</strong> ${escapeHtml(money(summary.remainingCents))}</p>
             ${receiptPayment?.receipt_token ? `<a href="${publicSiteUrl()}/receipt/${receiptPayment.receipt_token}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:800;">View / print receipt</a>` : ""}`
          ),
        });
      } catch (payerEmailError) {
        console.error("Stripe payer receipt email failed", payerEmailError);
      }
    }
  }

  if (!wasAlreadyPaid && process.env.MOORE_MADE_ADMIN_EMAIL) {
    const reference = formatRequestNumber(summary.request.request_number);
    const kindLabel = existing.payment_kind === "deposit"
      ? "Deposit"
      : existing.payment_kind === "balance"
        ? "Remaining balance"
        : "Full payment";
    await sendMooreMadeEmail({
      to: process.env.MOORE_MADE_ADMIN_EMAIL,
      subject: `${kindLabel} received — ${reference}`,
      replyTo: summary.request.email,
      html: emailShell(
        `Payment received — ${reference}`,
        `<p style="line-height:1.65;margin:0 0 16px;"><strong>${escapeHtml(summary.request.customer_name)}</strong> paid <strong>${escapeHtml(money(amountReceived))}</strong> toward <strong>${escapeHtml(reference)}</strong> (${escapeHtml(summary.request.product)}).</p>
         <div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:14px 16px;margin:0 0 18px;">
           <p style="margin:0 0 6px;"><strong>Total order:</strong> ${escapeHtml(money(summary.totalCents))}</p>
           <p style="margin:0 0 6px;"><strong>Paid to date:</strong> ${escapeHtml(money(summary.amountPaidCents))}</p>
           <p style="margin:0;"><strong>Remaining:</strong> ${escapeHtml(money(summary.remainingCents))}</p>
         </div>
         <a href="${process.env.SITE_URL || "http://localhost:3000"}/admin" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:800;">Open admin dashboard</a>`
      ),
    });
  }

  return {
    ok: true as const,
    summary,
    receiptToken: receiptPayment?.receipt_token || null,
    receiptNumber: receiptPayment?.receipt_number || null,
    receiptOrderNumber: receiptPayment?.receipt_order_number || summary.request.request_number,
    receiptPaymentSequence: receiptPayment?.receipt_payment_sequence || 1,
  };
}

export async function syncPaidCheckoutSessionById(sessionId: string) {
  if (!sessionId || !sessionId.startsWith("cs_")) return null;
  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid") return null;
  return recordPaidCheckoutSession(session);
}
