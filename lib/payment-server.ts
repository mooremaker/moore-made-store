import type Stripe from "stripe";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { emailShell, escapeHtml, sendMooreMadeEmail, siteUrl } from "@/lib/email";
import { money } from "@/lib/quote-types";
import { quoteRequiredDeposit, type PaymentTerms } from "@/lib/payment-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getStripe } from "@/lib/stripe";

export async function recalculateOrderPayment(requestId: string, quoteId: string) {
  const supabase = getSupabaseAdmin();
  const [{ data: quote }, { data: request }, { data: paymentRows }] = await Promise.all([
    supabase.from("quotes").select("id,total_cents,payment_terms,deposit_amount_cents").eq("id", quoteId).single(),
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
  const nextStatus = mayStartProduction && request.status === "approved" ? "in_production" : request.status;

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
    paymentStatus,
    orderStatus: nextStatus,
  };
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
    .select("id,status,amount_cents,payment_kind")
    .eq("id", paymentId)
    .single();
  if (existingError || !existing) throw new Error("Payment record not found.");

  const wasAlreadyPaid = existing.status === "paid";
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
  const { error: paymentError } = await supabase
    .from("payments")
    .update({
      status: "paid",
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      paid_at: new Date().toISOString(),
    })
    .eq("id", paymentId);
  if (paymentError) throw new Error("Could not record Stripe payment.");

  const summary = await recalculateOrderPayment(requestId, quoteId);
  const { data: receiptPayment } = await supabase
    .from("payments")
    .select("receipt_number,receipt_token")
    .eq("id", paymentId)
    .single();

  if (!wasAlreadyPaid) {
    try {
      const reference = formatRequestNumber(summary.request.request_number);
      await sendMooreMadeEmail({
        to: summary.request.email,
        subject: `Payment received — ${reference}`,
        html: emailShell(
          `Payment received — ${reference}`,
          `<p style="line-height:1.65;margin:0 0 16px;">Hi ${escapeHtml(summary.request.customer_name)}, we received your card payment of <strong>${escapeHtml(money(existing.amount_cents))}</strong> for <strong>${escapeHtml(reference)}</strong>.</p>
           <div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:14px 16px;margin:0 0 18px;">
             <p style="margin:0 0 6px;"><strong>Order total:</strong> ${escapeHtml(money(summary.totalCents))}</p>
             <p style="margin:0 0 6px;"><strong>Paid to date:</strong> ${escapeHtml(money(summary.amountPaidCents))}</p>
             <p style="margin:0;"><strong>Remaining:</strong> ${escapeHtml(money(summary.remainingCents))}</p>
           </div>
           <p style="line-height:1.65;margin:0 0 18px;">${summary.remainingCents <= 0 ? "Your order is paid in full. We’ll keep you updated when it is ready for pickup or ships." : "Your payment has been applied to the order. Any remaining balance stays attached to your order."}</p>
           ${receiptPayment?.receipt_token ? `<a href="${siteUrl()}/receipt/${receiptPayment.receipt_token}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:800;">View / print receipt</a>` : ""}`
        ),
      });
    } catch (customerEmailError) {
      console.error("Stripe customer receipt email failed", customerEmailError);
    }
  }

  if (!wasAlreadyPaid && process.env.MOORE_MADE_ADMIN_EMAIL) {
    const reference = formatRequestNumber(summary.request.request_number);
    const kindLabel = existing.payment_kind === "deposit" ? "Deposit" : existing.payment_kind === "balance" ? "Remaining balance" : "Full payment";
    await sendMooreMadeEmail({
      to: process.env.MOORE_MADE_ADMIN_EMAIL,
      subject: `${kindLabel} received — ${reference}`,
      replyTo: summary.request.email,
      html: emailShell(
        `Payment received — ${reference}`,
        `<p style="line-height:1.65;margin:0 0 16px;"><strong>${escapeHtml(summary.request.customer_name)}</strong> paid <strong>${escapeHtml(money(existing.amount_cents))}</strong> toward <strong>${escapeHtml(reference)}</strong> (${escapeHtml(summary.request.product)}).</p>
         <div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:14px 16px;margin:0 0 18px;">
           <p style="margin:0 0 6px;"><strong>Total order:</strong> ${escapeHtml(money(summary.totalCents))}</p>
           <p style="margin:0 0 6px;"><strong>Paid to date:</strong> ${escapeHtml(money(summary.amountPaidCents))}</p>
           <p style="margin:0;"><strong>Remaining:</strong> ${escapeHtml(money(summary.remainingCents))}</p>
         </div>
         <a href="${process.env.SITE_URL || "http://localhost:3000"}/admin" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:800;">Open admin dashboard</a>`
      ),
    });
  }

  return { ok: true as const, summary, receiptToken: receiptPayment?.receipt_token || null, receiptNumber: receiptPayment?.receipt_number || null };
}

export async function syncPaidCheckoutSessionById(sessionId: string) {
  if (!sessionId || !sessionId.startsWith("cs_")) return null;
  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid") return null;
  return recordPaidCheckoutSession(session);
}
