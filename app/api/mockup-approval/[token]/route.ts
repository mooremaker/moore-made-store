import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { emailShell, escapeHtml, sendMooreMadeEmail } from "@/lib/email";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { recordCustomerEmailNotification } from "@/lib/message-server";

export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = getSupabaseAdmin();
  const { data: review } = await supabase
    .from("mockup_review_sends")
    .select("id,request_id,version,approved_at,custom_requests(customer_name,product,request_number,email)")
    .eq("public_token", token)
    .maybeSingle();
  if (!review) return NextResponse.json({ error: "This mockup approval link is unavailable." }, { status: 404 });
  const order = Array.isArray(review.custom_requests) ? review.custom_requests[0] : review.custom_requests;
  if (!order) return NextResponse.json({ error: "This order is unavailable." }, { status: 404 });
  if (!review.approved_at) {
    const approvedAt = new Date().toISOString();
    const { error } = await supabase.from("mockup_review_sends").update({ approved_at: approvedAt }).eq("id", review.id);
    if (error) return NextResponse.json({ error: "Could not record mockup approval." }, { status: 500 });
    const reference = formatRequestNumber(order.request_number);
    await sendMooreMadeEmail({ to: process.env.MOORE_MADE_ADMIN_EMAIL || "", subject: `Mockup proof ${review.version} approved — ${reference}`, html: emailShell("Mockup approved", `<p><strong>${escapeHtml(order.customer_name)}</strong> approved mockup proof <strong>${review.version}</strong> for <strong>${escapeHtml(order.product)}</strong> (${reference}).</p>`) });
    await recordCustomerEmailNotification({ requestId: review.request_id, recipientEmails: String(order.email || ""), subject: `Mockup proof ${review.version} approved — ${reference}`, body: `The customer approved mockup proof ${review.version}.`, topic: "order", label: "Mockup approved" });
  }
  return NextResponse.json({ ok: true, alreadyApproved: Boolean(review.approved_at) });
}
