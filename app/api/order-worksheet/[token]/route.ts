import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { normalizeWorksheetColumns, normalizeWorksheetRows } from "@/lib/order-worksheet-types";
import { CUSTOM_REQUEST_BUCKET } from "@/lib/supabase-admin";
import { emailShell, escapeHtml, sendMooreMadeEmail } from "@/lib/email";

type Params = { params: Promise<{ token: string }> };

export async function GET(_: Request, { params }: Params) {
  const { token } = await params;
  const { data } = await getSupabaseAdmin().from("order_worksheets").select("id,request_id,public_token,title,instructions,columns,rows,submitted_file_paths,is_open,completed_at,updated_at,custom_requests(customer_name,product,request_number)").eq("public_token", token).single();
  if (!data) return NextResponse.json({ error: "This worksheet link is unavailable." }, { status: 404 });
  const order = Array.isArray(data.custom_requests) ? data.custom_requests[0] : data.custom_requests;
  return NextResponse.json({ worksheet: { ...data, columns: normalizeWorksheetColumns(data.columns), rows: normalizeWorksheetRows(data.rows, normalizeWorksheetColumns(data.columns)), order } });
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const form = await request.formData(); const file = form.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose a completed roster file first." }, { status: 400 });
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const acceptedExtensions = new Set(["pdf", "csv", "txt", "xls", "xlsx", "doc", "docx", "jpg", "jpeg", "png", "webp", "heic", "heif"]);
  const acceptedMimeTypes = new Set(["application/pdf", "text/csv", "text/plain", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
  if ((file.type && !file.type.startsWith("image/") && !acceptedMimeTypes.has(file.type)) || !acceptedExtensions.has(extension) || file.size > 12 * 1024 * 1024) return NextResponse.json({ error: "Upload a PDF, spreadsheet, Word document, CSV, text file, or image under 12 MB." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data: worksheet } = await supabase.from("order_worksheets").select("id,is_open,submitted_file_paths").eq("public_token", token).single();
  if (!worksheet || !worksheet.is_open) return NextResponse.json({ error: "This worksheet is no longer accepting uploads." }, { status: 409 });
  const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 120) || `completed-roster.${extension}`;
  const path = `order-worksheets/${worksheet.id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage.from(CUSTOM_REQUEST_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return NextResponse.json({ error: "Could not upload the worksheet image." }, { status: 500 });
  const previous = Array.isArray(worksheet.submitted_file_paths) ? worksheet.submitted_file_paths.filter((value): value is string => typeof value === "string") : [];
  await supabase.from("order_worksheets").update({ submitted_file_paths: [...previous, path] }).eq("id", worksheet.id);
  const { data: order } = await supabase.from("order_worksheets").select("custom_requests(customer_name,product,request_number)").eq("id", worksheet.id).single();
  const customerOrder = Array.isArray(order?.custom_requests) ? order.custom_requests[0] : order?.custom_requests;
  const adminEmail = process.env.MOORE_MADE_ADMIN_EMAIL;
  if (adminEmail) await sendMooreMadeEmail({ to: adminEmail, subject: `Completed roster uploaded${customerOrder?.request_number ? ` — MM-${String(customerOrder.request_number).padStart(6, "0")}` : ""}`, attachments: [{ filename: file.name, content: Buffer.from(await file.arrayBuffer()), contentType: file.type || undefined }], html: emailShell("Completed roster uploaded", `<p><strong>${escapeHtml(customerOrder?.customer_name || "A customer")}</strong> uploaded <strong>${escapeHtml(file.name)}</strong>${customerOrder?.product ? ` for ${escapeHtml(customerOrder.product)}` : ""}.</p><p>The uploaded file is attached to this email and saved with the order worksheet.</p>`) });
  return NextResponse.json({ ok: true, filename: file.name });
}

export async function PUT(request: Request, { params }: Params) {
  const { token } = await params;
  const body = await request.json().catch(() => ({}));
  const supabase = getSupabaseAdmin();
  const { data: worksheet } = await supabase.from("order_worksheets").select("id,columns,is_open").eq("public_token", token).single();
  if (!worksheet || !worksheet.is_open) return NextResponse.json({ error: "This worksheet is no longer accepting changes." }, { status: 409 });
  const columns = normalizeWorksheetColumns(worksheet.columns);
  const rows = normalizeWorksheetRows(body.rows, columns);
  const completed = Boolean(body.completed);
  const { error } = await supabase.from("order_worksheets").update({ rows, completed_at: completed ? new Date().toISOString() : null }).eq("id", worksheet.id);
  if (error) return NextResponse.json({ error: "Could not save your worksheet." }, { status: 500 });
  return NextResponse.json({ ok: true, completedAt: completed ? new Date().toISOString() : null });
}
