import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { emailShell, escapeHtml, publicSiteUrl, sendMooreMadeEmail } from "@/lib/email";
import { followUpProofFiles, followUpRecipients } from "@/lib/follow-up";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { recordCustomerEmailNotification } from "@/lib/message-server";
import { getSupabaseAdmin, QUOTE_PROOF_BUCKET } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const { requestId, reviewId, sendId, subject, message, includeMockups } = body;
    if (![requestId, reviewId, sendId].every(value => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value)) ||
      typeof subject !== "string" || subject.trim().length < 3 || subject.length > 180 || /[\r\n]/.test(subject) ||
      typeof message !== "string" || message.trim().length < 3 || message.length > 4000 || typeof includeMockups !== "boolean") {
      return NextResponse.json({ error: "Review the subject, message, and selected mockup before sending." }, { status: 400 });
    }
    let recipients: string[];
    try { recipients = followUpRecipients(body.recipientEmails); }
    catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
    const supabase = getSupabaseAdmin();
    const [{ data: order, error: orderError }, { data: review, error: reviewError }, { data: logs, error: logError }] = await Promise.all([
      supabase.from("custom_requests").select("id,request_number,customer_name,product,status").eq("id", requestId).single(),
      supabase.from("mockup_review_sends").select("id,public_token,files,approved_at,version").eq("request_id", requestId).order("version", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("notification_email_log").select("id").eq("request_id", requestId).limit(1),
    ]);
    if (orderError || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (reviewError || logError || !logs) return NextResponse.json({ error: "Communication history is unavailable. Restore it before sending a follow-up." }, { status: 503 });
    if (order.status === "cancelled") return NextResponse.json({ error: "This order has been cancelled." }, { status: 409 });
    if (!review || review.id !== reviewId || review.approved_at) return NextResponse.json({ error: "This proof is already approved or has been replaced. Refresh the order before following up." }, { status: 409 });
    const files = followUpProofFiles(review.files, requestId);
    const attachments: Array<{ filename: string; content: Buffer }> = [];
    if (includeMockups) {
      if (!files.length) return NextResponse.json({ error: "This proof has no saved mockups to attach." }, { status: 409 });
      let totalBytes = 0;
      for (const file of files) {
        const { data, error } = await supabase.storage.from(QUOTE_PROOF_BUCKET).download(file.path);
        if (error || !data) return NextResponse.json({ error: `Could not attach ${file.originalName}. Nothing has been sent.` }, { status: 409 });
        totalBytes += data.size;
        if (totalBytes > 15 * 1024 * 1024) return NextResponse.json({ error: "These attachments are too large. Turn off attachments to send the review link instead." }, { status: 400 });
        attachments.push({ filename: file.originalName, content: Buffer.from(await data.arrayBuffer()) });
      }
    }
    const reference = formatRequestNumber(order.request_number);
    const emailSubject = `${subject.trim()} — ${reference}`;
    const approvalUrl = `${publicSiteUrl()}/mockup-approval/${review.public_token}`;
    const summary = `${message.trim()}\n\nProof ${review.version}${includeMockups ? ` · ${files.length} mockup attachments` : " · review link included"}\n${approvalUrl}`;
    const html = emailShell("A quick follow-up from Moore Made", `<p>Hi ${escapeHtml(order.customer_name)},</p><div style="line-height:1.75;white-space:pre-wrap">${escapeHtml(message.trim())}</div><p><strong>Order:</strong> ${escapeHtml(reference)} · ${escapeHtml(order.product)}</p><p><a href="${escapeHtml(approvalUrl)}" style="display:inline-block;background:#171717;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">Review your mockups</a></p><p style="font-size:12px">You can also reply to this email with feedback.<br>Review link: <a href="${escapeHtml(approvalUrl)}">${escapeHtml(approvalUrl)}</a></p>`);
    const sent: string[] = [];
    const failed: Array<{ email: string; error: string }> = [];
    let historySaved = true;
    for (const recipient of recipients) {
      const payloadHash = createHash("sha256").update(JSON.stringify([recipient, emailSubject, message.trim(), review.id, includeMockups])).digest("hex");
      const email = await sendMooreMadeEmail({ to: recipient, subject: emailSubject, html, attachments, replyTo: process.env.MOORE_MADE_ADMIN_EMAIL, idempotencyKey: `follow-up-${sendId}-${payloadHash}` });
      if (email.ok) sent.push(recipient);
      else failed.push({ email: recipient, error: email.error });
      // A retry may receive the same provider ID. Avoid duplicating its history row.
      const existing = email.ok && email.id ? await supabase.from("notification_email_log").select("id").eq("provider_message_id", email.id).maybeSingle() : null;
      if (existing?.data) continue;
      const { error } = await supabase.from("notification_email_log").insert({ request_id: requestId, notification_type: "general", recipient_email: recipient, subject: emailSubject, status: email.ok ? "sent" : "failed", provider_message_id: email.ok ? email.id : null, error_message: email.ok ? null : email.error, created_by: auth.user.id });
      if (error) historySaved = false;
      if (email.ok) await recordCustomerEmailNotification({ requestId, recipientEmails: [recipient], subject: emailSubject, body: summary, topic: "order", label: "Mockup follow-up email sent" });
    }
    return NextResponse.json({ sent, failed, historySaved, error: !sent.length ? failed[0]?.error || "Email could not be sent." : undefined }, { status: sent.length ? 200 : 502 });
  } catch (error) {
    console.error("Mockup follow-up failed", error);
    return NextResponse.json({ error: "Could not send the follow-up. Your draft is still available to retry." }, { status: 500 });
  }
}
