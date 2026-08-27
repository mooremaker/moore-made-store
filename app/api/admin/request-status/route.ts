import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { formatRequestNumber, REQUEST_STATUSES } from "@/lib/custom-request-types";
import { emailShell, escapeHtml, publicSiteUrl, sendMooreMadeEmail } from "@/lib/email";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { recordCustomerEmailNotification } from "@/lib/message-server";

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json();
  const id = typeof body.id === "string" ? body.id : "";
  const status = typeof body.status === "string" ? body.status : "";

  if (!id || !REQUEST_STATUSES.includes(status as (typeof REQUEST_STATUSES)[number])) {
    return NextResponse.json({ error: "Invalid status update." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: current, error: currentError } = await supabase
    .from("custom_requests")
    .select("status,payment_status,request_number,customer_name,email,product,delivery,tracking_number,tracking_url,reviewing_email_sent_at,review_request_sent_at,review_request_token")
    .eq("id", id)
    .single();
  if (currentError || !current) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (status === "in_production" && current.payment_status === "unpaid") {
    return NextResponse.json({ error: "Required payment must be received before production begins." }, { status: 409 });
  }
  if (["ready", "shipped", "completed"].includes(status) && current.payment_status !== "paid") {
    return NextResponse.json({ error: "This order must be paid in full before final fulfillment." }, { status: 409 });
  }
  const { error } = await supabase.from("custom_requests").update({ status }).eq("id", id);

  if (error) {
    console.error("Admin status update failed", error);
    return NextResponse.json({ error: "Could not update this request." }, { status: 500 });
  }

  const shouldSendReviewingEmail = status === "reviewing" && current.status !== "reviewing" && !current.reviewing_email_sent_at;
  if (shouldSendReviewingEmail) {
    const sentAt = new Date().toISOString();
    const reference = formatRequestNumber(current.request_number);
    const emailResult = await sendMooreMadeEmail({
      to: current.email,
      subject: `We’re reviewing your Moore Made order — ${reference}`,
      replyTo: process.env.MOORE_MADE_ADMIN_EMAIL,
      html: emailShell("We have your order and are reviewing it.", `<p style="font-size:16px;line-height:1.7;margin:0 0 14px;">Hi ${escapeHtml(current.customer_name)}, thank you for choosing Moore Made. We’re reviewing your <strong>${escapeHtml(current.product)}</strong> order <strong>${escapeHtml(reference)}</strong> now.</p><p style="line-height:1.7;margin:0 0 14px;">We’ll send your next update within <strong>1–2 business days</strong>. If we need sizes, names, artwork clarification, or another detail, we’ll reach out through your order messages.</p><p style="line-height:1.7;margin:0;">No payment is due until we send your complete proof and personalized quote for approval.</p>`),
    });
    await getSupabaseAdmin().from("notification_email_log").insert({ request_id: id, quote_id: null, notification_type: "reviewing", recipient_email: current.email, subject: `We’re reviewing your Moore Made order — ${reference}`, status: emailResult.ok ? "sent" : "failed", provider_message_id: emailResult.id || null, error_message: emailResult.ok ? null : emailResult.error || "Email could not be sent.", created_by: auth.user.id, sent_at: sentAt });
    if (emailResult.ok) {
      await getSupabaseAdmin().from("custom_requests").update({ reviewing_email_sent_at: sentAt }).eq("id", id).is("reviewing_email_sent_at", null);
      await recordCustomerEmailNotification({ requestId: id, recipientEmails: current.email, subject: `We’re reviewing your Moore Made order — ${reference}`, body: "Your order is being reviewed. Moore Made will send the next update within 1–2 business days.", topic: "order", label: "Order reviewing email sent" });
    }
  }

  const shouldSendReviewRequest = status === "completed" && current.status !== "completed" && !current.review_request_sent_at;
  if (shouldSendReviewRequest) {
    if (!current.review_request_token) {
      return NextResponse.json({ error: "The order was completed, but its secure review link is missing. Run the latest database patch, then use Resend review email on this order.", saved: true }, { status: 503 });
    }
    // Claim the invitation before sending so two simultaneous completion updates
    // cannot send the customer duplicate review requests.
    const claimedAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from("custom_requests")
      .update({ review_request_sent_at: claimedAt })
      .eq("id", id)
      .is("review_request_sent_at", null)
      .select("id")
      .maybeSingle();

    if (claimError) {
      console.error("Review request claim failed", claimError);
      return NextResponse.json({ error: "The order was completed, but the review invitation could not be prepared. Run the latest database patch, then use Resend review email on this order.", saved: true }, { status: 502 });
    }

    if (claimed) {
      const reference = formatRequestNumber(current.request_number);
      const reviewUrl = `${publicSiteUrl()}/made-by-you/submit?review=${current.review_request_token}`;
      const delivery = String(current.delivery || "").toLowerCase();
      const fulfillmentMessage = delivery.includes("ship")
        ? `${current.tracking_url ? `Your order has shipped. <a href="${escapeHtml(current.tracking_url)}" style="color:#1f4f78;font-weight:700;">Track your shipment</a>${current.tracking_number ? ` (${escapeHtml(current.tracking_number)})` : ""}.` : `Your order has shipped${current.tracking_number ? ` · tracking ${escapeHtml(current.tracking_number)}` : ""}.`}`
        : delivery.includes("delivery") ? "Your order has been delivered." : "Your order is ready for pickup.";
      const emailResult = await sendMooreMadeEmail({
        to: current.email,
        subject: "Your Moore Made order is complete — we’d love your review",
        replyTo: process.env.MOORE_MADE_ADMIN_EMAIL,
        html: emailShell(
          "Order complete — thank you!",
          `<p style="font-size:16px;line-height:1.7;margin:0 0 14px;">Hi ${escapeHtml(current.customer_name)}, your <strong>${escapeHtml(current.product)}</strong> order <strong>${escapeHtml(reference)}</strong> is complete. ${fulfillmentMessage}</p>
           <p style="line-height:1.7;margin:0 0 18px;">We hope you love how it turned out. If you have a moment, we would really appreciate a review and photos of your finished items.</p>
           <p style="margin:0 0 20px;"><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;font-weight:800;padding:13px 20px;border-radius:8px;">Leave a review</a></p>
           <p style="font-size:13px;line-height:1.6;color:#6b6b6b;margin:0;">Your private link has your completed order details ready for you. Sharing is optional and every review is approved before it appears publicly.</p>`
        ),
      });

      if (!emailResult.ok) {
        // Release the claim so changing the order away from Completed and back
        // to Completed can retry the invitation after the email issue is fixed.
        await supabase.from("custom_requests").update({ review_request_sent_at: null }).eq("id", id).eq("review_request_sent_at", claimedAt);
        await supabase.from("notification_email_log").insert({ request_id: id, quote_id: null, notification_type: "general", recipient_email: current.email, subject: "Your Moore Made order is complete — we’d love your review", status: "failed", provider_message_id: null, error_message: emailResult.error || "Email could not be sent.", created_by: auth.user.id, sent_at: new Date().toISOString() });
        return NextResponse.json({ error: "The order was completed, but the review invitation email could not be sent. Fix the email issue, then use Resend review email on this order.", saved: true }, { status: 502 });
      }

      await supabase.from("notification_email_log").insert({ request_id: id, quote_id: null, notification_type: "general", recipient_email: current.email, subject: "Your Moore Made order is complete — we’d love your review", status: "sent", provider_message_id: emailResult.id || null, error_message: null, created_by: auth.user.id, sent_at: claimedAt });
      await recordCustomerEmailNotification({ requestId: id, recipientEmails: current.email, subject: "Your Moore Made order is complete — we’d love your review", body: "Completed-order review invitation sent with a private prefilled review link.", topic: "order", label: "Review invitation email sent" });

      return NextResponse.json({ ok: true, reviewRequestSent: true, reviewRequestSentAt: claimedAt });
    }
  }

  return NextResponse.json({ ok: true, reviewRequestSent: false, reviewingEmailSent: shouldSendReviewingEmail });
}
