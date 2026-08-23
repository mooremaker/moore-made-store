import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { FUNDING_DOCUMENT_BUCKET, FUNDING_ENTRY_TYPE_LABELS, type FundingEntryType, type FundingPartyKind } from "@/lib/finance-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const entryTypes = new Set(Object.keys(FUNDING_ENTRY_TYPE_LABELS));
const partyKinds = new Set(["member", "family", "external"]);
const MAX_DOCUMENTS = 5;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

function clean(value: FormDataEntryValue | null | unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeName(name: string) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "document";
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const form = await request.formData();
    const entryDate = clean(form.get("entryDate"), 10);
    const partyName = clean(form.get("partyName"), 160);
    const partyKind = clean(form.get("partyKind"), 20) as FundingPartyKind;
    const entryType = clean(form.get("entryType"), 40) as FundingEntryType;
    const amountCents = Math.round(Number(form.get("amountCents") || 0));
    const paymentMethod = clean(form.get("paymentMethod"), 100) || null;
    const reference = clean(form.get("reference"), 200) || null;
    const note = clean(form.get("note"), 1500) || null;
    const ownershipRaw = clean(form.get("ownershipPercent"), 20);
    const ownershipPercent = ownershipRaw ? Number(ownershipRaw) : null;
    const giftAcknowledged = clean(form.get("giftAcknowledged"), 10) === "yes";
    const documents = form.getAll("documents").filter((value): value is File => value instanceof File && value.size > 0);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return NextResponse.json({ error: "Choose a valid date." }, { status: 400 });
    if (!partyName) return NextResponse.json({ error: "Enter the person or funding source." }, { status: 400 });
    if (!partyKinds.has(partyKind)) return NextResponse.json({ error: "Choose who provided or received the money." }, { status: 400 });
    if (!entryTypes.has(entryType)) return NextResponse.json({ error: "Choose a valid funding type." }, { status: 400 });
    if (entryType === "owner_draw" && partyKind !== "member") return NextResponse.json({ error: "An owner draw must be assigned to a Moore Made owner/member." }, { status: 400 });
    if (!Number.isInteger(amountCents) || amountCents <= 0) return NextResponse.json({ error: "Enter a valid amount." }, { status: 400 });
    if (ownershipPercent != null && (!Number.isFinite(ownershipPercent) || ownershipPercent < 0 || ownershipPercent > 100)) return NextResponse.json({ error: "Ownership percent must be between 0 and 100." }, { status: 400 });
    if (entryType === "equity_investment" && ownershipPercent == null) return NextResponse.json({ error: "Enter the ownership percent documented for this equity investment." }, { status: 400 });
    if (entryType === "gift_received" && !giftAcknowledged) return NextResponse.json({ error: "Confirm that this is an unconditional gift with nothing promised in return." }, { status: 400 });
    if (documents.length > MAX_DOCUMENTS) return NextResponse.json({ error: `Attach no more than ${MAX_DOCUMENTS} documents.` }, { status: 400 });
    for (const file of documents) {
      if (file.size > MAX_DOCUMENT_BYTES) return NextResponse.json({ error: `${file.name} is larger than 20 MB.` }, { status: 400 });
      if (!ALLOWED.has(file.type)) return NextResponse.json({ error: `${file.name} must be a PDF or image.` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: entry, error } = await supabase.from("business_funding_entries").insert({
      entry_date: entryDate,
      party_name: partyName,
      party_kind: partyKind,
      entry_type: entryType,
      amount_cents: amountCents,
      payment_method: paymentMethod,
      reference,
      note,
      ownership_percent: entryType === "equity_investment" ? ownershipPercent : null,
      recorded_by: auth.user.id,
    }).select("id").single();

    if (error || !entry) {
      console.error("Funding entry insert failed", error);
      if (entryType === "owner_draw" && error?.code === "23514") return NextResponse.json({ error: "Run the Phase 6.59 owner-draw SQL update in Supabase, then save this draw again." }, { status: 409 });
      return NextResponse.json({ error: "Could not save this funding entry." }, { status: 500 });
    }

    const uploadedPaths: string[] = [];
    try {
      for (let index = 0; index < documents.length; index++) {
        const file = documents[index];
        const path = `${entry.id}/${Date.now()}-${index}-${safeName(file.name)}`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { error: uploadError } = await supabase.storage.from(FUNDING_DOCUMENT_BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
        uploadedPaths.push(path);
        const { error: docError } = await supabase.from("business_funding_documents").insert({ funding_entry_id: entry.id, storage_path: path, original_filename: file.name, mime_type: file.type || null, size_bytes: file.size });
        if (docError) throw docError;
      }
    } catch (documentError) {
      console.error("Funding document upload failed", documentError);
      if (uploadedPaths.length) await supabase.storage.from(FUNDING_DOCUMENT_BUCKET).remove(uploadedPaths);
      await supabase.from("business_funding_entries").delete().eq("id", entry.id);
      return NextResponse.json({ error: "The funding entry could not be saved because a document upload failed." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: entry.id });
  } catch (error) {
    console.error("Funding route failed", error);
    return NextResponse.json({ error: "Could not save this funding entry." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!id) return NextResponse.json({ error: "Funding entry id is required." }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("business_funding_entries").update({ voided_at: new Date().toISOString(), voided_by: auth.user.id, void_reason: reason || "Voided by admin" }).eq("id", id).is("voided_at", null);
    if (error) return NextResponse.json({ error: "Could not void this entry." }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Funding void failed", error);
    return NextResponse.json({ error: "Could not void this entry." }, { status: 500 });
  }
}
