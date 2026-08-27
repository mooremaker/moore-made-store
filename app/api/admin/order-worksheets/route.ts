import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { emailShell, escapeHtml, publicSiteUrl, sendMooreMadeEmail } from "@/lib/email";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { DEFAULT_ORDER_WORKSHEET_COLUMNS, normalizeWorksheetColumns, normalizeWorksheetRows } from "@/lib/order-worksheet-types";
import { createOrderWorksheetPdf } from "@/lib/order-worksheet-pdf";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const auth = await requireAdminApi(); if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const requestId = new URL(request.url).searchParams.get("requestId");
  if (!requestId) return NextResponse.json({ error: "Order is required." }, { status: 400 });
  const { data } = await getSupabaseAdmin().from("order_worksheets").select("id,request_id,public_token,title,instructions,columns,rows,is_open,last_sent_at,completed_at,updated_at").eq("request_id", requestId).maybeSingle();
  return NextResponse.json({ worksheet: data ? { ...data, columns: normalizeWorksheetColumns(data.columns), rows: normalizeWorksheetRows(data.rows, normalizeWorksheetColumns(data.columns)) } : null });
}

export async function POST(request: Request) {
  const auth = await requireAdminApi(); if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  if (!requestId) return NextResponse.json({ error: "Order is required." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data: order } = await supabase.from("custom_requests").select("id,customer_name,email,product,request_number").eq("id", requestId).single();
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  const columns = normalizeWorksheetColumns(body.columns || DEFAULT_ORDER_WORKSHEET_COLUMNS);
  const rows = normalizeWorksheetRows(body.rows || [], columns);
  const patch = { request_id: requestId, title: String(body.title || "Employee shirt roster").trim().slice(0, 120) || "Order worksheet", instructions: String(body.instructions || "").trim().slice(0, 2000) || null, columns, rows, is_open: body.isOpen !== false };
  const { data: worksheet, error } = await supabase.from("order_worksheets").upsert(patch, { onConflict: "request_id" }).select("id,request_id,public_token,title,instructions,columns,rows,is_open,last_sent_at,completed_at,updated_at").single();
  if (error || !worksheet) return NextResponse.json({ error: "Could not save the worksheet. Run the order worksheet SQL update first." }, { status: 500 });
  if (!body.sendEmail) return NextResponse.json({ worksheet: { ...worksheet, columns, rows } });
  const recipients = String(body.recipientEmails || order.email).split(/[,;\n]/).map((email) => email.trim()).filter(Boolean).slice(0, 10);
  if (!recipients.length) return NextResponse.json({ error: "Enter at least one email address." }, { status: 400 });
  const link = `${publicSiteUrl()}/order-worksheet/${worksheet.public_token}`;
  const subject = `Complete your Moore Made order worksheet · ${formatRequestNumber(order.request_number)}`;
  const attachment = createOrderWorksheetPdf({ title: worksheet.title, orderNumber: formatRequestNumber(order.request_number), product: order.product, columns, rows });
  const filename = `${worksheet.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "moore-made-order-worksheet"}-${formatRequestNumber(order.request_number)}.pdf`;
  const sent = await Promise.all(recipients.map((to) => sendMooreMadeEmail({ to, subject, replyTo: process.env.MOORE_MADE_ADMIN_EMAIL, attachments: [{ filename, content: attachment, contentType: "application/pdf" }], html: emailShell("A quick order detail is needed", `<p style="font-size:16px;line-height:1.7">Hi ${escapeHtml(order.customer_name)}, we have your mockup and are gathering the final details for <strong>${escapeHtml(order.product)}</strong>.</p><div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:15px 16px;margin:0 0 18px"><strong>What this worksheet is for</strong><p style="line-height:1.65;margin:7px 0 0">Please use it to collect each person&apos;s name and shirt size. If anyone would like a last name printed on the back, mark that choice and enter the name exactly as it should print. If no back name is wanted, simply leave those fields blank.</p></div><p style="font-weight:800;line-height:1.6;margin:0 0 8px">Choose whichever submission method is easiest:</p><ol style="line-height:1.7;margin:0 0 18px;padding-left:22px"><li><strong>Fill it out online:</strong> use the button below, add one row for each person, then select <strong>Save &amp; mark complete</strong> when the roster is ready.</li><li><strong>Use paper:</strong> print the attached PDF, fill it in clearly, then open the same online link and select <strong>Upload worksheet photo</strong> to send us a clear photo or scan.</li></ol><p style="line-height:1.7">You can share the link with your office and return to it anytime before marking it complete. <strong>No quote, payment, or final approval is being requested yet.</strong> Once we have the completed roster, Moore Made will review the details and send the next proof and personalized quote.</p><p style="margin:24px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#171717;color:#fff;padding:13px 20px;border-radius:8px;text-decoration:none;font-weight:800">Fill it out online</a></p><p style="font-size:13px;line-height:1.6;color:#6b6b6b;margin:0">Need help or need more rows? Reply to this email and we&apos;ll help.</p>`) }))); 
  const failed = sent.filter((result) => !result.ok).length;
  await supabase.from("order_worksheets").update({ last_sent_at: new Date().toISOString() }).eq("id", worksheet.id);
  return NextResponse.json({ worksheet: { ...worksheet, columns, rows }, sent: recipients.length - failed, failed, link });
}
