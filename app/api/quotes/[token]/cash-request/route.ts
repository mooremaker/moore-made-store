import { NextResponse } from "next/server";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { emailShell, escapeHtml, isEmailConfigured, sendMooreMadeEmail } from "@/lib/email";
import { nextPaymentAmount, type PaymentTerms } from "@/lib/payment-types";
import { money } from "@/lib/quote-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { FINAL_SALE_POLICY_VERSION } from "@/lib/payment-policy";

export async function POST(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("quotes")
      .select("id,status,total_cents,payment_terms,deposit_amount_cents,proof_version,custom_requests(id,request_number,customer_name,email,phone,sms_consent,payment_status,amount_paid_cents,cash_payment_request_status,cash_payment_requested_at)")
      .eq("public_token", token)
      .single();

    if (error || !data) return NextResponse.json({ error: "This quote could not be found." }, { status: 404 });
    if (data.status !== "approved") return NextResponse.json({ error: "Approve the proof + quote before requesting cash payment." }, { status: 400 });

    const orderRaw = Array.isArray(data.custom_requests) ? data.custom_requests[0] : data.custom_requests;
    if (!orderRaw) return NextResponse.json({ error: "The order could not be found." }, { status: 404 });
    const order = orderRaw as {
      id: string; request_number: number; customer_name: string; email: string; phone: string | null; sms_consent: boolean;
      payment_status: "unpaid" | "deposit_paid" | "paid"; amount_paid_cents: number;
      cash_payment_request_status: "none" | "pending" | "contacted" | "completed" | "cancelled" | null;
      cash_payment_requested_at: string | null;
    };

    if (order.payment_status === "paid") return NextResponse.json({ error: "This order is already paid in full." }, { status: 400 });

    const { data: policyAcceptance, error: policyError } = await supabase
      .from("order_policy_acceptances")
      .select("id")
      .eq("quote_id", data.id)
      .eq("proof_version", Math.max(1, Number(data.proof_version || 1)))
      .eq("policy_version", FINAL_SALE_POLICY_VERSION)
      .maybeSingle();
    if (policyError || !policyAcceptance) {
      return NextResponse.json({ error: "Accept the final-sale custom-order terms before arranging payment." }, { status: 409 });
    }

    if (order.cash_payment_request_status === "pending" || order.cash_payment_request_status === "contacted") {
      return NextResponse.json({ ok: true, alreadyRequested: true });
    }

    const paymentStep = nextPaymentAmount({
      totalCents: Number(data.total_cents || 0),
      terms: (data.payment_terms === "deposit" ? "deposit" : "full") as PaymentTerms,
      depositAmountCents: data.deposit_amount_cents,
      amountPaidCents: Number(order.amount_paid_cents || 0),
    });
    if (paymentStep.amountCents <= 0) return NextResponse.json({ error: "No payment is currently due." }, { status: 400 });

    const now = new Date().toISOString();
    const { error: updateError } = await supabase.from("custom_requests").update({
      cash_payment_request_status: "pending",
      cash_payment_requested_at: now,
      cash_payment_requested_amount_cents: paymentStep.amountCents,
      cash_payment_contacted_at: null,
    }).eq("id", order.id);
    if (updateError) {
      console.error("Cash payment request update failed", updateError);
      return NextResponse.json({ error: "Could not save the cash payment request." }, { status: 500 });
    }

    if (isEmailConfigured()) {
      const reference = formatRequestNumber(order.request_number);
      const adminEmail = process.env.MOORE_MADE_ADMIN_EMAIL!;
      await Promise.allSettled([
        sendMooreMadeEmail({
          to: adminEmail,
          replyTo: order.email,
          subject: `Cash payment requested — ${reference}`,
          html: emailShell(
            `Cash payment requested — ${reference}`,
            `<p style="line-height:1.65;margin:0 0 16px;"><strong>${escapeHtml(order.customer_name)}</strong> requested to arrange a cash payment of <strong>${escapeHtml(money(paymentStep.amountCents))}</strong>.</p>
             <div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:14px 16px;margin:0 0 18px;">
               <p style="margin:0 0 6px;"><strong>Order:</strong> ${escapeHtml(reference)}</p>
               <p style="margin:0 0 6px;"><strong>Email:</strong> ${escapeHtml(order.email)}</p>
               <p style="margin:0 0 6px;"><strong>Phone:</strong> ${escapeHtml(order.phone || "Not provided")}</p>
               <p style="margin:0;"><strong>Text permission:</strong> ${order.phone && order.sms_consent ? "Yes — customer opted in to order texts" : "No"}</p>
             </div>
             <p style="line-height:1.65;margin:0;">Open the Moore Made admin dashboard to contact the customer and arrange the payment. Do not mark the order paid until the cash has actually been received.</p>`
          ),
        }),
        sendMooreMadeEmail({
          to: order.email,
          subject: `Cash payment request received — ${reference}`,
          html: emailShell(
            `Cash payment request received — ${reference}`,
            `<p style="line-height:1.65;margin:0 0 16px;">Hi ${escapeHtml(order.customer_name)}, we received your request to arrange a cash payment of <strong>${escapeHtml(money(paymentStep.amountCents))}</strong>.</p>
             <p style="line-height:1.65;margin:0 0 16px;">Moore Made will contact you to coordinate payment. Your order will remain unpaid until the cash is received and confirmed.</p>
             <p style="line-height:1.65;margin:0;">Once payment is recorded, we&apos;ll email you a confirmation. You&apos;ll receive a separate pickup or shipping notification when your order is complete.</p>`
          ),
        }),
      ]);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Cash payment request route failed", error);
    return NextResponse.json({ error: "Could not request cash payment." }, { status: 500 });
  }
}
