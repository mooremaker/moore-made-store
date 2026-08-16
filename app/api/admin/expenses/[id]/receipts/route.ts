import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { EXPENSE_RECEIPT_BUCKET } from "@/lib/finance-types";
import { uploadExpenseReceiptFiles, validateExpenseReceiptFiles } from "@/lib/expense-receipt-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const { data: expense } = await supabase.from("business_expenses").select("id").eq("id", id).maybeSingle();
    if (!expense) return NextResponse.json({ error: "Expense not found." }, { status: 404 });

    const form = await request.formData();
    const files = form.getAll("receipts").filter((value): value is File => value instanceof File && value.size > 0);
    const fileError = validateExpenseReceiptFiles(files);
    if (!files.length) return NextResponse.json({ error: "Choose at least one receipt file." }, { status: 400 });
    if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });

    const upload = await uploadExpenseReceiptFiles(supabase, id, auth.user.id, files);
    if (!upload.ok) return NextResponse.json({ error: "Could not upload the receipt." }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Expense receipt add failed", error);
    return NextResponse.json({ error: "Could not upload the receipt." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id } = await params;
    const body = await request.json();
    const receiptId = typeof body.receiptId === "string" ? body.receiptId.trim() : "";
    if (!receiptId) return NextResponse.json({ error: "Receipt id is required." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: receipt } = await supabase
      .from("business_expense_receipts")
      .select("id,storage_path")
      .eq("id", receiptId)
      .eq("expense_id", id)
      .maybeSingle();
    if (!receipt) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });

    const { error } = await supabase.from("business_expense_receipts").delete().eq("id", receiptId).eq("expense_id", id);
    if (error) return NextResponse.json({ error: "Could not remove the receipt." }, { status: 500 });

    const { error: storageError } = await supabase.storage.from(EXPENSE_RECEIPT_BUCKET).remove([receipt.storage_path]);
    if (storageError) console.error("Expense receipt storage delete failed", storageError);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Expense receipt delete failed", error);
    return NextResponse.json({ error: "Could not remove the receipt." }, { status: 500 });
  }
}
