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
    .select("status,payment_status,request_number,customer_name,email,product,review_request_sent_at")
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

  const shouldSendReviewRequest = status === "completed" && current.status !== "completed" && !current.review_request_sent_at;
  if (shouldSendReviewRequest) {
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
      return NextResponse.json({ error: "The order was completed, but the review invitation could not be prepared. Run the latest database update, then mark the order complete again.", saved: true }, { status: 502 });
    }

    if (claimed) {
      const reference = formatRequestNumber(current.request_number);
      const reviewUrl = `${publicSiteUrl()}/made-by-you/submit`;
      const emailResult = await sendMooreMadeEmail({
        to: current.email,
        subject: `Would you like to review your Moore Made order? — ${reference}`,
        replyTo: process.env.MOORE_MADE_ADMIN_EMAIL,
        html: emailShell(
          "Would you like to review your order?",
          `<p style="font-size:16px;line-height:1.7;margin:0 0 16px;">Hi ${escapeHtml(current.customer_name)}, your <strong>${escapeHtml(current.product)}</strong> order <strong>${escapeHtml(reference)}</strong> is complete. We hope you love how it turned out!</p>
           <p style="line-height:1.7;margin:0 0 18px;">If you have a moment, we would love to hear about your experience. You can leave a review and optionally share photos of your finished order.</p>
           <p style="margin:0 0 20px;"><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;font-weight:800;padding:13px 20px;border-radius:999px;">Review your order</a></p>
           <p style="font-size:13px;line-height:1.6;color:#6b6b6b;margin:0;">Sharing a review is completely optional. Every submission is reviewed before it appears publicly.</p>`
        ),
      });

      if (!emailResult.ok) {
        // Release the claim so changing the order away from Completed and back
        // to Completed can retry the invitation after the email issue is fixed.
        await supabase.from("custom_requests").update({ review_request_sent_at: null }).eq("id", id).eq("review_request_sent_at", claimedAt);
        return NextResponse.json({ error: "The order was completed, but the review invitation email could not be sent. Fix the email issue, then mark the order complete again to retry.", saved: true }, { status: 502 });
      }

      await recordCustomerEmailNotification({ requestId: id, recipientEmails: current.email, subject: `Would you like to review your Moore Made order? — ${reference}`, body: "Your order is complete. If you would like, you can leave a review and optionally share finished-order photos.", topic: "order", label: "Review invitation email sent" });

      return NextResponse.json({ ok: true, reviewRequestSent: true });
    }
  }

  return NextResponse.json({ ok: true, reviewRequestSent: false });
}
