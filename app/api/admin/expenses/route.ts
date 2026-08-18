import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { EXPENSE_CATEGORY_LABELS, type BusinessExpenseCategory } from "@/lib/finance-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { uploadExpenseReceiptFiles, validateExpenseReceiptFiles } from "@/lib/expense-receipt-server";

const categories = new Set(Object.keys(EXPENSE_CATEGORY_LABELS));

function clean(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const form = await request.formData();
    const vendor = clean(form.get("vendor"), 160);
    const category = clean(form.get("category"), 40) as BusinessExpenseCategory;
    const description = clean(form.get("description"), 500) || null;
    const paymentMethod = clean(form.get("paymentMethod"), 100) || null;
    const note = clean(form.get("note"), 1000) || null;
    const expenseDate = clean(form.get("expenseDate"), 10);
    const amountCents = Math.round(Number(form.get("amountCents") || 0));
    const files = form.getAll("receipts").filter((value): value is File => value instanceof File && value.size > 0);
    const fileError = validateExpenseReceiptFiles(files);

    if (!vendor) return NextResponse.json({ error: "Vendor / payee is required." }, { status: 400 });
    if (!categories.has(category)) return NextResponse.json({ error: "Choose a valid expense category." }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) return NextResponse.json({ error: "Choose a valid expense date." }, { status: 400 });
    if (!Number.isInteger(amountCents) || amountCents <= 0) return NextResponse.json({ error: "Enter a valid expense amount." }, { status: 400 });
    if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: expense, error } = await supabase.from("business_expenses").insert({
      expense_date: expenseDate,
      vendor,
      category,
      description,
      amount_cents: amountCents,
      payment_method: paymentMethod,
      note,
      recorded_by: auth.user.id,
    }).select("id").single();

    if (error || !expense) {
      console.error("Expense insert failed", error);
      return NextResponse.json({ error: "Could not save this expense." }, { status: 500 });
    }

    if (files.length) {
      const upload = await uploadExpenseReceiptFiles(supabase, expense.id, auth.user.id, files);
      if (!upload.ok) {
        await supabase.from("business_expenses").delete().eq("id", expense.id);
        return NextResponse.json({ error: "The expense could not be saved because its receipt upload failed." }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, id: expense.id });
  } catch (error) {
    console.error("Expense route failed", error);
    return NextResponse.json({ error: "Could not save this expense." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const id = clean(body.id, 80);
    const reason = clean(body.reason, 500) || "Voided by admin";
    if (!id) return NextResponse.json({ error: "Expense id is required." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("business_expenses").update({
      voided_at: new Date().toISOString(),
      voided_by: auth.user.id,
      void_reason: reason,
    }).eq("id", id).is("voided_at", null);

    if (error) return NextResponse.json({ error: "Could not void this expense." }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Expense void failed", error);
    return NextResponse.json({ error: "Could not void this expense." }, { status: 500 });
  }
}
