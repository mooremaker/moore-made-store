import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { emailShell, escapeHtml, publicSiteUrl, sendMooreMadeEmail } from "@/lib/email";
import { recordCustomerEmailNotification } from "@/lib/message-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await request.json().catch(() => ({}));
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "Order is required." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data: order } = await supabase
    .from("custom_requests")
    .select("id,status,request_number,customer_name,email,product,delivery,tracking_number,tracking_url,review_request_token")
    .eq("id", id)
    .single();
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.status !== "completed") return NextResponse.json({ error: "Complete the order before sending its review request." }, { status: 409 });
  if (!order.review_request_token) return NextResponse.json({ error: "Run the latest database update to create secure review links." }, { status: 503 });
  const reference = formatRequestNumber(order.request_number);
  const delivery = String(order.delivery || "").toLowerCase();
  const fulfillmentMessage = delivery.includes("ship")
    ? order.tracking_url ? `Your order has shipped. <a href="${escapeHtml(order.tracking_url)}" style="color:#1f4f78;font-weight:700;">Track your shipment</a>${order.tracking_number ? ` (${escapeHtml(order.tracking_number)})` : ""}.` : `Your order has shipped${order.tracking_number ? ` · tracking ${escapeHtml(order.tracking_number)}` : ""}.`
    : delivery.includes("delivery") ? "Your order has been delivered." : "Your order is ready for pickup.";
  const reviewUrl = `${publicSiteUrl()}/made-by-you/submit?review=${order.review_request_token}`;
  const subject = "Your Moore Made order is complete — we’d love your review";
  const result = await sendMooreMadeEmail({
    to: order.email,
    subject,
    replyTo: process.env.MOORE_MADE_ADMIN_EMAIL,
    html: emailShell("Order complete — thank you!", `<p style="font-size:16px;line-height:1.7;margin:0 0 14px;">Hi ${escapeHtml(order.customer_name)}, your <strong>${escapeHtml(order.product)}</strong> order <strong>${escapeHtml(reference)}</strong> is complete. ${fulfillmentMessage}</p><p style="line-height:1.7;margin:0 0 18px;">We hope you love how it turned out. If you have a moment, we would really appreciate a review and photos of your finished items.</p><p style="margin:0 0 20px;"><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;font-weight:800;padding:13px 20px;border-radius:8px;">Leave a review</a></p>`),
  });
  if (!result.ok) return NextResponse.json({ error: "Could not send the review request. Check the email setup and try again." }, { status: 502 });
  const sentAt = new Date().toISOString();
  await supabase.from("custom_requests").update({ review_request_sent_at: sentAt }).eq("id", id);
  await supabase.from("notification_email_log").insert({ request_id: id, quote_id: null, notification_type: "general", recipient_email: order.email, subject, status: "sent", provider_message_id: result.id || null, error_message: null, created_by: auth.user.id, sent_at: sentAt });
  await recordCustomerEmailNotification({ requestId: id, recipientEmails: order.email, subject, body: "Completed-order review invitation resent with a private prefilled review link.", topic: "order", label: "Review invitation email resent" });
  return NextResponse.json({ ok: true, sentAt });
}
