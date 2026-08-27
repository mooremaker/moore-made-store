import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { normalizeWorksheetColumns, normalizeWorksheetRows } from "@/lib/order-worksheet-types";
import { CUSTOM_REQUEST_BUCKET } from "@/lib/supabase-admin";

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
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose an image first." }, { status: 400 });
  if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) return NextResponse.json({ error: "Upload a JPG, PNG, or other image under 12 MB." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data: worksheet } = await supabase.from("order_worksheets").select("id,is_open,submitted_file_paths").eq("public_token", token).single();
  if (!worksheet || !worksheet.is_open) return NextResponse.json({ error: "This worksheet is no longer accepting uploads." }, { status: 409 });
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "jpg";
  const path = `order-worksheets/${worksheet.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(CUSTOM_REQUEST_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return NextResponse.json({ error: "Could not upload the worksheet image." }, { status: 500 });
  const previous = Array.isArray(worksheet.submitted_file_paths) ? worksheet.submitted_file_paths.filter((value): value is string => typeof value === "string") : [];
  await supabase.from("order_worksheets").update({ submitted_file_paths: [...previous, path] }).eq("id", worksheet.id);
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
