import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { emailShell, escapeHtml, publicSiteUrl, sendMooreMadeEmail } from "@/lib/email";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { createOrderWorksheetPdf } from "@/lib/order-worksheet-pdf";
import { normalizeWorksheetColumns, normalizeWorksheetRows } from "@/lib/order-worksheet-types";
import { QUOTE_PROOF_BUCKET, getSupabaseAdmin } from "@/lib/supabase-admin";
import { recordCustomerEmailNotification } from "@/lib/message-server";

type FileInput = { path?: unknown; originalName?: unknown };
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const safeName = (value: unknown, fallback: string) => String(value || fallback).replace(/[^a-z0-9._ -]/gi, "-").slice(0, 120) || fallback;
const emailParagraphs = (value: string) => escapeHtml(value).split(/\r?\n\s*\r?\n/).filter(Boolean).map((paragraph) => `<p style="line-height:1.7;margin:0 0 16px">${paragraph.replace(/\r?\n/g, "<br>")}</p>`).join("");

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const requestId = new URL(request.url).searchParams.get("requestId");
  if (!requestId) return NextResponse.json({ error: "Order is required." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("mockup_review_sends")
    .select("id,version,recipient_emails,note,files,sent_at,approved_at,approved_note")
    .eq("request_id", requestId)
    .order("version", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load sent mockups. Run the mockup review history SQL update first." }, { status: 500 });
  const reviews = await Promise.all((data || []).map(async (review) => {
    const rawFiles = Array.isArray(review.files) ? review.files : [];
    const files = await Promise.all(rawFiles.map(async (raw) => {
      const file = raw && typeof raw === "object" ? raw as { path?: unknown; originalName?: unknown } : {};
      const path = typeof file.path === "string" ? file.path : "";
      const { data: signed } = path ? await supabase.storage.from(QUOTE_PROOF_BUCKET).createSignedUrl(path, 900) : { data: null };
      return { path, originalName: safeName(file.originalName, "Mockup proof"), url: signed?.signedUrl || null };
    }));
    return { ...review, files };
  }));
  return NextResponse.json({ reviews });
}

export async function POST(request: Request) {
  const auth = await requireAdminApi(); if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json(); const requestId = typeof body.requestId === "string" ? body.requestId : "";
    const recipientEmails = String(body.recipientEmail || "").split(/[,;\n]/).map((value) => value.trim()).filter(validEmail).slice(0, 10);
    const files: Array<{ path: string; originalName: string }> = (Array.isArray(body.files) ? body.files : []).map((file: FileInput) => ({ path: typeof file.path === "string" ? file.path : "", originalName: safeName(file.originalName, "mockup-proof") })).filter((file: { path: string; originalName: string }) => file.path);
    if (!requestId || !files.length) return NextResponse.json({ error: "Upload at least one selected mockup first." }, { status: 400 });
    const supabase = getSupabaseAdmin(); const { data: order } = await supabase.from("custom_requests").select("id,customer_name,email,product,request_number").eq("id", requestId).single();
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    const recipients = recipientEmails.length ? recipientEmails : validEmail(order.email) ? [order.email] : [];
    if (!recipients.length) return NextResponse.json({ error: "Enter a valid customer email address." }, { status: 400 });
    if (files.some((file) => !file.path.startsWith(`${requestId}/`))) return NextResponse.json({ error: "A selected mockup does not belong to this order." }, { status: 400 });
    const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
    for (const file of files) { const { data, error } = await supabase.storage.from(QUOTE_PROOF_BUCKET).download(file.path); if (error || !data) return NextResponse.json({ error: `Could not attach ${file.originalName}.` }, { status: 500 }); attachments.push({ filename: file.originalName, content: Buffer.from(await data.arrayBuffer()) }); }
    const note = String(body.note || "").trim().slice(0, 3000) || "Please review the attached mockups and let us know whether you approve the design direction or would like any changes.";
    const { data: latestReview, error: latestReviewError } = await supabase.from("mockup_review_sends").select("version").eq("request_id", requestId).order("version", { ascending: false }).limit(1).maybeSingle();
    if (latestReviewError) return NextResponse.json({ error: "Could not save mockup history. Run the mockup review history SQL update first." }, { status: 500 });
    const { data: review, error: reviewError } = await supabase.from("mockup_review_sends").insert({ request_id: requestId, version: Number(latestReview?.version || 0) + 1, recipient_emails: recipients, note, files }).select("id,version,public_token").single();
    if (reviewError || !review) return NextResponse.json({ error: "Could not save mockup history. Run the mockup review history SQL update first." }, { status: 500 });
    const { data: worksheet } = await supabase.from("order_worksheets").select("public_token,title,columns,rows,is_open").eq("request_id", requestId).maybeSingle();
    const worksheetLink = worksheet?.is_open && worksheet.public_token ? `${publicSiteUrl()}/order-worksheet/${worksheet.public_token}` : null;
    if (worksheet && worksheetLink) { const columns = normalizeWorksheetColumns(worksheet.columns); const rows = normalizeWorksheetRows(worksheet.rows, columns); attachments.push({ filename: `${safeName(worksheet.title, "employee-shirt-roster")}-${formatRequestNumber(order.request_number)}.pdf`, content: createOrderWorksheetPdf({ title: worksheet.title, orderNumber: formatRequestNumber(order.request_number), product: order.product, columns, rows }), contentType: "application/pdf" }); }
    const rosterSection = worksheetLink ? `<div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:15px 16px;margin:18px 0"><strong>Employee roster included</strong><p style="line-height:1.65;margin:7px 0 12px">We also attached a printable employee roster. Use it to collect names, shirt sizes, and optional back-name details. You may complete it online instead, or print it and upload a clear photo/scan through the same link.</p><a href="${escapeHtml(worksheetLink)}" style="display:inline-block;background:#171717;color:#fff;padding:12px 17px;border-radius:8px;text-decoration:none;font-weight:800">Fill out the roster online</a></div>` : "";
    const reference = formatRequestNumber(order.request_number); const subject = `Mockup review needed — ${reference}`;
    const approvalUrl = `${publicSiteUrl()}/mockup-approval/${review.public_token}`;
    const portalUrl = `${publicSiteUrl()}/account`;
    const actions = `<div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:16px;margin:20px 0 0"><strong style="display:block;margin:0 0 12px">Quick actions</strong>${approvalUrl ? `<a href="${escapeHtml(approvalUrl)}" style="display:inline-block;background:#171717;color:#fff;padding:12px 16px;border-radius:8px;text-decoration:none;font-weight:800;margin:0 8px 10px 0">Approve mockups</a>` : ""}${worksheetLink ? `<a href="${escapeHtml(worksheetLink)}" style="display:inline-block;background:#fff;color:#171717;border:1px solid #171717;padding:11px 15px;border-radius:8px;text-decoration:none;font-weight:800;margin:0 8px 10px 0">Complete or upload roster</a>` : ""}<a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#fff;color:#171717;border:1px solid #171717;padding:11px 15px;border-radius:8px;text-decoration:none;font-weight:800;margin:0 0 10px">Open your order portal</a></div>`;
    const sent = await Promise.all(recipients.map((to) => sendMooreMadeEmail({ to, subject, replyTo: process.env.MOORE_MADE_ADMIN_EMAIL, attachments, html: emailShell("Your mockups are ready to review", `<p style="font-size:16px;line-height:1.7;margin:0 0 18px">Hi ${escapeHtml(order.customer_name)}, we&apos;ve attached the selected mockup designs for your <strong>${escapeHtml(order.product)}</strong> order.</p><div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:15px 16px;margin:0 0 18px"><strong style="display:block;margin:0 0 12px">What we need from you</strong>${emailParagraphs(note)}</div><ol style="line-height:1.7;margin:0 0 16px;padding-left:22px"><li>Review each attached mockup.</li><li>Reply with changes, or use <strong>Approve mockups</strong> below.</li><li>Complete the employee roster if it applies to your order.</li></ol>${rosterSection}<div style="background:#eef4ef;border:1px solid #cfe0d2;border-radius:12px;padding:15px 16px;margin:18px 0"><strong style="display:block;margin:0 0 8px">What happens next</strong><p style="line-height:1.65;margin:0">We&apos;re waiting for your mockup approval and any remaining order details. Once we have everything needed, Moore Made will make any final refinements, prepare your personalized quote, and send it separately for your approval and payment.</p></div><p style="line-height:1.7;margin:0"><strong>No pricing, payment, or final order approval is being requested in this email.</strong> This step is only to make sure the mockup direction and order details are right.</p>${actions}`) }))); const failed = sent.filter((result) => !result.ok).length;
    if (failed === recipients.length) await supabase.from("mockup_review_sends").delete().eq("id", review.id);
    if (recipients.length !== failed) await recordCustomerEmailNotification({ requestId, recipientEmails: recipients.join(", "), subject, body: `Mockup review sent with ${files.length} selected proof file${files.length === 1 ? "" : "s"}${worksheetLink ? " and an employee roster" : ""}. No quote or payment was included.\n\nCustomer message:\n${note}`, topic: "order", label: "Mockup review email sent" });
    return NextResponse.json({ ok: failed === 0, sent: recipients.length - failed, failed });
  } catch (error) { console.error("Mockup review email failed", error); return NextResponse.json({ error: "Could not send mockup review." }, { status: 500 }); }
}
