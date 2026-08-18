import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { emailShell, escapeHtml, sendMooreMadeEmail, siteUrl } from "@/lib/email";
import { recalculateOrderPayment } from "@/lib/payment-server";
import { money } from "@/lib/quote-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { FINAL_SALE_POLICY_VERSION } from "@/lib/payment-policy";

const METHODS = new Set(["cashapp", "cash", "check", "other"]);

function methodLabel(method: string) {
  if (method === "cashapp") return "Cash App";
  if (method === "cash") return "Cash";
  if (method === "check") return "Check";
  return "Other";
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const requestId = String(body.requestId || "");
    const quoteId = String(body.quoteId || "");
    const amountCents = Math.round(Number(body.amountCents || 0));
    const paymentMethod = String(body.paymentMethod || "cashapp").toLowerCase();
    const reference = String(body.reference || "").trim().slice(0, 200) || null;
    const note = String(body.note || "").trim().slice(0, 1000) || null;

    if (!requestId || !quoteId) return NextResponse.json({ error: "Order and quote are required." }, { status: 400 });
    if (!Number.isInteger(amountCents) || amountCents <= 0) return NextResponse.json({ error: "Enter a valid payment amount." }, { status: 400 });
    if (!METHODS.has(paymentMethod)) return NextResponse.json({ error: "Choose a valid payment method." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const [{ data: quote }, { data: order }, { data: paidRows }] = await Promise.all([
      supabase.from("quotes").select("id,request_id,public_token,status,total_cents,payment_terms,deposit_amount_cents,proof_version").eq("id", quoteId).eq("request_id", requestId).single(),
      supabase.from("custom_requests").select("id,request_number,customer_name,email,product,cash_payment_request_status").eq("id", requestId).single(),
      supabase.from("payments").select("amount_cents,status").eq("request_id", requestId),
    ]);

    if (!quote || !order) return NextResponse.json({ error: "Order payment details could not be found." }, { status: 404 });
    if (quote.status !== "approved") return NextResponse.json({ error: "The customer must approve the proof + quote before payment is recorded." }, { status: 400 });

    const { data: policyAcceptance, error: policyError } = await supabase
      .from("order_policy_acceptances")
      .select("id")
      .eq("quote_id", quote.id)
      .eq("proof_version", Math.max(1, Number(quote.proof_version || 1)))
      .eq("policy_version", FINAL_SALE_POLICY_VERSION)
      .maybeSingle();
    if (policyError || !policyAcceptance) {
      return NextResponse.json({ error: "The customer must accept the final-sale custom-order terms before payment is recorded." }, { status: 409 });
    }

    const alreadyPaid = (paidRows ?? []).filter((row) => row.status === "paid").reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
    const totalCents = Math.max(0, Number(quote.total_cents || 0));
    const remainingCents = Math.max(0, totalCents - alreadyPaid);
    if (amountCents > remainingCents) return NextResponse.json({ error: `Only ${money(remainingCents)} remains on this order.` }, { status: 400 });

    const paymentKind = alreadyPaid > 0 ? "balance" : amountCents >= totalCents ? "full" : "deposit";
    const { data: paymentRow, error: insertError } = await supabase.from("payments").insert({
      request_id: requestId,
      quote_id: quoteId,
      payment_kind: paymentKind,
      amount_cents: amountCents,
      currency: "usd",
      status: "paid",
      payment_method: paymentMethod,
      manual_reference: reference,
      manual_note: note,
      recorded_by: auth.user.id,
      paid_at: new Date().toISOString(),
    }).select("id,receipt_number,receipt_token").single();
    if (insertError || !paymentRow) {
      console.error("Manual payment insert failed", insertError);
      return NextResponse.json({ error: "Could not record the payment in Supabase." }, { status: 500 });
    }

    const summary = await recalculateOrderPayment(requestId, quoteId);
    if (["pending", "contacted"].includes(String(order.cash_payment_request_status || ""))) {
      await supabase.from("custom_requests").update(summary.remainingCents <= 0 ? {
        cash_payment_request_status: "completed",
        cash_payment_contacted_at: new Date().toISOString(),
      } : {
        cash_payment_request_status: "none",
        cash_payment_requested_at: null,
        cash_payment_requested_amount_cents: null,
        cash_payment_contacted_at: null,
      }).eq("id", requestId);
    }
    const referenceNumber = formatRequestNumber(order.request_number);

    try {
      await sendMooreMadeEmail({
        to: order.email,
        subject: `Payment recorded — ${referenceNumber}`,
        html: emailShell(
          `Payment recorded — ${referenceNumber}`,
          `<p style="line-height:1.65;margin:0 0 16px;">Hi ${escapeHtml(order.customer_name)}, we recorded your <strong>${escapeHtml(methodLabel(paymentMethod))}</strong> payment of <strong>${escapeHtml(money(amountCents))}</strong> for ${escapeHtml(referenceNumber)}.</p>
           <div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:14px 16px;margin:0 0 18px;">
             <p style="margin:0 0 6px;"><strong>Order total:</strong> ${escapeHtml(money(summary.totalCents))}</p>
             <p style="margin:0 0 6px;"><strong>Paid to date:</strong> ${escapeHtml(money(summary.amountPaidCents))}</p>
             <p style="margin:0;"><strong>Remaining:</strong> ${escapeHtml(money(summary.remainingCents))}</p>
           </div>
           <p style="line-height:1.65;margin:0 0 18px;">${summary.remainingCents <= 0 ? "Your order is paid in full. We’ll keep you updated when it is ready for pickup or ships." : "Your payment has been applied to the order. Any remaining balance stays attached to your order."}</p>
           <p style="line-height:1.55;margin:0 0 18px;color:#6b6b6b;font-size:13px;"><strong>Custom order — all sales final.</strong> Deposits and payments are non-refundable. If you are unhappy with your finished order, contact Moore Made and we will do our best to rectify the issue.</p>
           <div style="display:flex;gap:10px;flex-wrap:wrap;">
             ${quote.public_token ? `<a href="${siteUrl()}/invoice/${quote.public_token}" style="display:inline-block;background:#fff;color:#171717;border:1px solid #d7d1c8;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:800;">View invoice</a>` : ""}
             ${paymentRow.receipt_token ? `<a href="${siteUrl()}/receipt/${paymentRow.receipt_token}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:800;">View / print receipt</a>` : ""}
           </div>`
        ),
      });
    } catch (emailError) {
      console.error("Manual payment confirmation email failed", emailError);
    }

    return NextResponse.json({
      ok: true,
      message: `${money(amountCents)} ${methodLabel(paymentMethod)} payment recorded.`,
      summary,
      receiptToken: paymentRow.receipt_token,
      receiptNumber: paymentRow.receipt_number,
    });
  } catch (error) {
    console.error("Manual payment route failed", error);
    return NextResponse.json({ error: "Could not record the payment." }, { status: 500 });
  }
}
