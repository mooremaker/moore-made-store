import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { emailShell, escapeHtml, publicSiteUrl, sendMooreMadeEmail } from "@/lib/email";
import { money, type QuoteLineItem } from "@/lib/quote-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const TYPES = ["quote_approval", "order_received", "payment_receipt", "production_update", "ready", "shipped", "general"] as const;
type NotificationType = (typeof TYPES)[number];

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmails(value: unknown) {
  const raw = Array.isArray(value) ? value.map((item) => text(item, 320)) : text(value, 3200).split(/[;,\n]+/);
  return [...new Set(raw.map((item) => item.trim().toLowerCase()).filter((item) => item && validEmail(item)))].slice(0, 10);
}

function displayDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function button(label: string, url: string) {
  return `<p style="margin:22px 0 12px;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;font-weight:800;padding:13px 20px;border-radius:999px;">${escapeHtml(label)}</a></p>
  <div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:12px 14px;margin:0 0 18px;font-size:12px;line-height:1.55;color:#6b6b6b;word-break:break-all;">
    <strong style="color:#171717;">If the button does not open:</strong><br>
    Tap or copy this link into Safari/Chrome:<br>
    <a href="${escapeHtml(url)}" style="color:#171717;">${escapeHtml(url)}</a>
  </div>`;
}

async function logEmail(input: {
  requestId: string;
  quoteId?: string | null;
  type: NotificationType;
  recipient: string;
  subject: string;
  status: "sent" | "failed";
  messageId?: string | null;
  error?: string | null;
  createdBy?: string | null;
}) {
  try {
    await getSupabaseAdmin().from("notification_email_log").insert({
      request_id: input.requestId,
      quote_id: input.quoteId || null,
      notification_type: input.type,
      recipient_email: input.recipient,
      subject: input.subject,
      status: input.status,
      provider_message_id: input.messageId || null,
      error_message: input.error || null,
      created_by: input.createdBy || null,
      sent_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Notification email audit log failed", error);
  }
}

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(request.url);
  const requestId = text(url.searchParams.get("requestId"), 100);
  if (!requestId) return NextResponse.json({ error: "Order is required." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const [{ data: quote }, { data: logs, error: logError }] = await Promise.all([
    supabase.from("quotes").select("id,status,public_token").eq("request_id", requestId).maybeSingle(),
    supabase.from("notification_email_log").select("id,notification_type,recipient_email,subject,status,error_message,sent_at").eq("request_id", requestId).order("sent_at", { ascending: false }).limit(30),
  ]);

  const approvalUrl = quote?.status === "sent" && quote.public_token ? `${publicSiteUrl()}/quote/${quote.public_token}` : null;
  return NextResponse.json({
    ok: true,
    approvalUrl,
    quoteStatus: quote?.status || null,
    logs: logError ? [] : logs || [],
    logReady: !logError,
  });
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const requestId = text(body.requestId, 100);
    const type = TYPES.includes(body.type as NotificationType) ? (body.type as NotificationType) : null;
    const recipients = normalizeEmails(body.recipientEmails);
    if (!requestId || !type) return NextResponse.json({ error: "Choose an order and notification type." }, { status: 400 });
    if (!recipients.length) return NextResponse.json({ error: "Enter at least one valid email address." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: order, error: orderError } = await supabase
      .from("custom_requests")
      .select("id,request_number,customer_name,email,product,status,delivery,tracking_number,tracking_url,fulfillment_note,estimated_fulfillment_date,estimated_fulfillment_note,payment_status,amount_paid_cents")
      .eq("id", requestId)
      .single();
    if (orderError || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

    const { data: quote } = await supabase
      .from("quotes")
      .select("id,status,public_token,total_cents,line_items,shipping_cents,tax_cents,discount_cents,proof_version")
      .eq("request_id", requestId)
      .maybeSingle();

    const { data: latestPayment } = await supabase
      .from("payments")
      .select("id,amount_cents,payment_method,payer_name,payer_email,paid_at,receipt_number,receipt_token,status")
      .eq("request_id", requestId)
      .eq("status", "paid")
      .order("paid_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const reference = formatRequestNumber(order.request_number);
    const customerName = order.customer_name || "customer";
    let subject = "";
    let title = "";
    let htmlBody = "";

    if (type === "quote_approval") {
      if (!quote || quote.status !== "sent" || !quote.public_token) {
        return NextResponse.json({ error: "There is not a quote currently waiting for approval. This resend does not create or change quote versions." }, { status: 409 });
      }
      const approvalUrl = `${publicSiteUrl()}/quote/${quote.public_token}`;
      const lines = Array.isArray(quote.line_items) ? (quote.line_items as QuoteLineItem[]) : [];
      const itemSummary = lines.length
        ? `<ul style="margin:8px 0 0;padding-left:20px;line-height:1.55;">${lines.slice(0, 20).map((item) => `<li>${escapeHtml(item.description)} · ${Math.max(1, Number(item.quantity || 1))}</li>`).join("")}</ul>`
        : `<p style="margin:8px 0 0;">${escapeHtml(order.product)}</p>`;
      subject = `Action needed: review your Moore Made proof + quote — ${reference}`;
      title = "Your Moore Made order is ready for review.";
      htmlBody = `<p style="font-size:16px;line-height:1.7;margin:0 0 16px;">Hi ${escapeHtml(customerName)}, your current Moore Made proof + quote is waiting for you.</p>
        <div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:14px;padding:16px;margin:0 0 18px;line-height:1.65;">
          <div><strong>Order:</strong> ${escapeHtml(reference)}</div>
          <div><strong>Total:</strong> ${escapeHtml(money(Number(quote.total_cents || 0)))}</div>
          <div><strong>Proof version:</strong> ${Math.max(1, Number(quote.proof_version || 1))}</div>
          ${itemSummary}
        </div>
        <p style="font-size:15px;line-height:1.7;margin:0 0 10px;"><strong>What to do:</strong> tap the button below, look over the mockup and order details, then choose <em>Approve</em> or <em>Request changes</em>.</p>
        ${button("Review & approve my order", approvalUrl)}
        <p style="font-size:13px;line-height:1.6;color:#6b6b6b;margin:0;">This is the same current approval version. Resending this email does not change the quote or create a new revision.</p>`;
    } else if (type === "order_received") {
      subject = `We received your Moore Made request — ${reference}`;
      title = "Your request is safely in our hands.";
      htmlBody = `<p style="font-size:16px;line-height:1.7;margin:0 0 16px;">Hi ${escapeHtml(customerName)}, we received your <strong>${escapeHtml(order.product)}</strong> request <strong>${escapeHtml(reference)}</strong>.</p>
        <p style="line-height:1.7;margin:0 0 16px;">Moore Made will review the details and prepare your mockup + personalized quote. No payment is due until the proof and quote are ready for approval.</p>
        <p style="line-height:1.7;margin:0;color:#6b6b6b;">If we need clarification, we'll contact you.</p>`;
    } else if (type === "payment_receipt") {
      if (!latestPayment) return NextResponse.json({ error: "There is no completed payment to resend a receipt for." }, { status: 409 });
      const receiptUrl = latestPayment.receipt_token ? `${publicSiteUrl()}/receipt/${latestPayment.receipt_token}` : "";
      subject = `Payment receipt — ${reference}`;
      title = "Payment received.";
      htmlBody = `<p style="font-size:16px;line-height:1.7;margin:0 0 16px;">Hi ${escapeHtml(customerName)}, this is a copy of the latest payment confirmation for Moore Made order <strong>${escapeHtml(reference)}</strong>.</p>
        <div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:14px;padding:16px;margin:0 0 18px;line-height:1.65;">
          <div><strong>Payment:</strong> ${escapeHtml(money(Number(latestPayment.amount_cents || 0)))}</div>
          ${latestPayment.payment_method ? `<div><strong>Method:</strong> ${escapeHtml(latestPayment.payment_method)}</div>` : ""}
          ${latestPayment.payer_name ? `<div><strong>Paid by:</strong> ${escapeHtml(latestPayment.payer_name)}</div>` : ""}
        </div>
        ${receiptUrl ? button("View / print payment receipt", receiptUrl) : `<p style="line-height:1.7;margin:0;">The payment is recorded on the order. A printable receipt link is not available for this older payment.</p>`}`;
    } else if (type === "production_update") {
      if (!['in_production','ready','shipped','completed'].includes(String(order.status))) {
        return NextResponse.json({ error: "This order is not in production yet." }, { status: 409 });
      }
      const isShipping = String(order.delivery || "").toLowerCase().includes("ship");
      const dateLabel = isShipping ? "Estimated ship date" : "Estimated pickup-ready date";
      const dateHtml = order.estimated_fulfillment_date ? `<div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:14px;padding:16px;margin:0 0 18px;"><div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#6b6b6b;">${escapeHtml(dateLabel)}</div><div style="font-size:24px;font-weight:900;margin-top:5px;">${escapeHtml(displayDate(order.estimated_fulfillment_date))}</div></div>` : "";
      const noteHtml = order.estimated_fulfillment_note ? `<p style="line-height:1.7;margin:0 0 18px;"><strong>Note from Moore Made:</strong><br>${escapeHtml(order.estimated_fulfillment_note).replaceAll("\n", "<br>")}</p>` : "";
      subject = `Moore Made production update — ${reference}`;
      title = "Your order is in production.";
      htmlBody = `<p style="font-size:16px;line-height:1.7;margin:0 0 16px;">Hi ${escapeHtml(customerName)}, here's an update on order <strong>${escapeHtml(reference)}</strong>.</p>${dateHtml}${noteHtml}<p style="font-size:13px;line-height:1.6;color:#6b6b6b;margin:0;">Dates are estimates, not guarantees. We'll send another notification when the order is officially ready or shipped.</p>`;
    } else if (type === "ready") {
      if (!['ready','completed'].includes(String(order.status))) return NextResponse.json({ error: "This order is not marked ready for pickup." }, { status: 409 });
      subject = `Your Moore Made order is ready for pickup — ${reference}`;
      title = "Your order is ready for pickup.";
      htmlBody = `<p style="font-size:16px;line-height:1.7;margin:0 0 16px;">Hi ${escapeHtml(customerName)}, your <strong>${escapeHtml(order.product)}</strong> order <strong>${escapeHtml(reference)}</strong> is ready for pickup.</p>${order.fulfillment_note ? `<p style="line-height:1.7;margin:0 0 16px;">${escapeHtml(order.fulfillment_note).replaceAll("\n", "<br>")}</p>` : ""}<p style="line-height:1.7;margin:0;color:#6b6b6b;">Thanks for choosing Moore Made.</p>`;
    } else if (type === "shipped") {
      if (!['shipped','completed'].includes(String(order.status))) return NextResponse.json({ error: "This order is not marked shipped." }, { status: 409 });
      subject = `Your Moore Made order has shipped — ${reference}`;
      title = "Your order is on the way.";
      const tracking = order.tracking_number || order.tracking_url ? `<div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:14px;padding:16px;margin:0 0 18px;line-height:1.65;">${order.tracking_number ? `<div><strong>Tracking:</strong> ${escapeHtml(order.tracking_number)}</div>` : ""}${order.tracking_url ? `<div style="margin-top:8px;"><a href="${escapeHtml(order.tracking_url)}" style="color:#171717;font-weight:800;">Track shipment →</a></div>` : ""}</div>` : "";
      htmlBody = `<p style="font-size:16px;line-height:1.7;margin:0 0 16px;">Hi ${escapeHtml(customerName)}, your <strong>${escapeHtml(order.product)}</strong> order <strong>${escapeHtml(reference)}</strong> has shipped.</p>${tracking}${order.fulfillment_note ? `<p style="line-height:1.7;margin:0 0 16px;">${escapeHtml(order.fulfillment_note).replaceAll("\n", "<br>")}</p>` : ""}<p style="line-height:1.7;margin:0;color:#6b6b6b;">Thanks for choosing Moore Made.</p>`;
    } else {
      const customSubject = text(body.customSubject, 180);
      const customMessage = text(body.customMessage, 4000);
      if (customSubject.length < 3 || customMessage.length < 3) return NextResponse.json({ error: "Add a subject and message for a general update." }, { status: 400 });
      subject = `${customSubject} — ${reference}`;
      title = customSubject;
      htmlBody = `<p style="font-size:16px;line-height:1.7;margin:0 0 16px;">Hi ${escapeHtml(customerName)},</p><p style="line-height:1.75;margin:0 0 18px;">${escapeHtml(customMessage).replaceAll("\n", "<br>")}</p><div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:12px 14px;font-size:13px;"><strong>Order:</strong> ${escapeHtml(reference)}</div>`;
    }

    const sent: string[] = [];
    const failed: Array<{ email: string; error: string }> = [];
    for (const recipient of recipients) {
      const emailResult = await sendMooreMadeEmail({
        to: recipient,
        subject,
        replyTo: process.env.MOORE_MADE_ADMIN_EMAIL,
        html: emailShell(title, htmlBody),
      });
      if (emailResult.ok) {
        sent.push(recipient);
        await logEmail({ requestId, quoteId: quote?.id || null, type, recipient, subject, status: "sent", messageId: emailResult.id, createdBy: auth.user.id });
      } else {
        const errorMessage = emailResult.error || "Email could not be sent.";
        failed.push({ email: recipient, error: errorMessage });
        await logEmail({ requestId, quoteId: quote?.id || null, type, recipient, subject, status: "failed", error: errorMessage, createdBy: auth.user.id });
      }
    }

    if (!sent.length) return NextResponse.json({ error: failed[0]?.error || "Email could not be sent.", sent, failed }, { status: 502 });
    return NextResponse.json({ ok: true, sent, failed, approvalUrl: type === "quote_approval" && quote?.public_token ? `${publicSiteUrl()}/quote/${quote.public_token}` : null });
  } catch (error) {
    console.error("Admin notification email failed", error);
    return NextResponse.json({ error: "Could not send this notification email." }, { status: 500 });
  }
}
