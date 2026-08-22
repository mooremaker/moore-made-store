import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { emailShell, escapeHtml, sendMooreMadeEmail } from "@/lib/email";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { recordCustomerEmailNotification } from "@/lib/message-server";

type FulfillmentMode = "pickup" | "delivery" | "shipping";

function text(value: unknown, max = 3000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeTrackingUrl(value: unknown) {
  const raw = text(value, 1000);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function fulfillmentMode(value: unknown): FulfillmentMode | "" {
  if (value === "pickup") return "pickup";
  if (value === "delivery") return "delivery";
  if (value === "shipping" || value === "shipped") return "shipping";
  return "";
}

function deliveryLabel(mode: FulfillmentMode) {
  if (mode === "shipping") return "Shipping";
  if (mode === "delivery") return "Local delivery";
  return "Local pickup";
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const id = text(body.id, 100);
    const mode = fulfillmentMode(body.mode);
    if (!id || !mode) return NextResponse.json({ error: "Choose Local pickup, Local delivery, or Shipping." }, { status: 400 });

    const trackingNumber = text(body.trackingNumber, 200);
    const trackingUrl = safeTrackingUrl(body.trackingUrl);
    const note = text(body.note, 3000);
    const status = mode === "shipping" ? "shipped" : "ready";
    const now = new Date().toISOString();

    const supabase = getSupabaseAdmin();
    const { data: row, error } = await supabase
      .from("custom_requests")
      .select("id,request_number,customer_name,email,product,payment_status,amount_paid_cents")
      .eq("id", id)
      .single();
    if (error || !row) return NextResponse.json({ error: "Order not found." }, { status: 404 });

    if (row.payment_status !== "paid") {
      return NextResponse.json({ error: "This order still has a balance due. Collect the remaining payment before marking it ready for pickup, ready for delivery, or shipped." }, { status: 409 });
    }

    const { error: updateError } = await supabase.from("custom_requests").update({
      status,
      delivery: deliveryLabel(mode),
      tracking_number: mode === "shipping" ? trackingNumber || null : null,
      tracking_url: mode === "shipping" ? trackingUrl || null : null,
      fulfillment_note: note || null,
      fulfillment_notified_at: now,
    }).eq("id", id);
    if (updateError) {
      console.error("Fulfillment status update failed", updateError);
      return NextResponse.json({ error: "Could not update fulfillment status." }, { status: 500 });
    }

    const reference = formatRequestNumber(row.request_number);
    const trackingHtml = mode === "shipping" && (trackingNumber || trackingUrl)
      ? `<div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:14px 16px;margin:0 0 18px;">
          ${trackingNumber ? `<p style="margin:0 0 6px;"><strong>Tracking:</strong> ${escapeHtml(trackingNumber)}</p>` : ""}
          ${trackingUrl ? `<a href="${escapeHtml(trackingUrl)}" style="color:#171717;font-weight:700;">Track your shipment →</a>` : ""}
        </div>` : "";
    const noteHtml = note ? `<p style="line-height:1.65;margin:0 0 18px;">${escapeHtml(note).replaceAll("\n", "<br>")}</p>` : "";

    const subject = mode === "shipping"
      ? `Your Moore Made order has shipped — ${reference}`
      : mode === "delivery"
        ? `Your Moore Made order is ready for delivery — ${reference}`
        : `Your Moore Made order is ready for pickup — ${reference}`;
    const title = mode === "shipping"
      ? "Your order is on the way."
      : mode === "delivery"
        ? "Your order is ready for delivery."
        : "Your order is ready for pickup.";
    const statusSentence = mode === "shipping"
      ? "has shipped."
      : mode === "delivery"
        ? "is ready for local delivery."
        : "is ready for pickup.";

    const emailResult = await sendMooreMadeEmail({
      to: row.email,
      subject,
      replyTo: process.env.MOORE_MADE_ADMIN_EMAIL,
      html: emailShell(
        title,
        `<p style="line-height:1.65;margin:0 0 16px;">Hi ${escapeHtml(row.customer_name)}, your <strong>${escapeHtml(row.product)}</strong> order <strong>${escapeHtml(reference)}</strong> ${statusSentence}</p>
         ${trackingHtml}${noteHtml}
         <p style="line-height:1.65;margin:0;color:#6b6b6b;">Thanks for choosing Moore Made.</p>`
      ),
    });

    if (!emailResult.ok) {
      return NextResponse.json({ error: "The order status was saved, but the customer email could not be sent. Fix the email issue and send this notification again.", saved: true }, { status: 502 });
    }

    await recordCustomerEmailNotification({ requestId: id, recipientEmails: row.email, subject, body: `${title}${trackingNumber ? ` Tracking: ${trackingNumber}.` : ""}${note ? ` ${note}` : ""}`, topic: "shipping", label: "Fulfillment email sent" });

    return NextResponse.json({ ok: true, status, delivery: deliveryLabel(mode) });
  } catch (error) {
    console.error("Fulfillment notification failed", error);
    return NextResponse.json({ error: "Could not send fulfillment notification." }, { status: 500 });
  }
}
