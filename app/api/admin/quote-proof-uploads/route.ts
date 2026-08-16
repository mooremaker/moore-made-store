import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { QUOTE_PROOF_BUCKET, getSupabaseAdmin } from "@/lib/supabase-admin";

const MAX_FILES_PER_BATCH = 50;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function text(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sanitizeFileName(name: string) {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return cleaned || "proof-file";
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const requestId = text(body.requestId, 100);
    const itemKey = text(body.itemKey, 100) || "proof-item";
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES_PER_BATCH) : [];

    if (!requestId || files.length === 0) {
      return NextResponse.json({ error: "Choose at least one proof file." }, { status: 400 });
    }
    if (Array.isArray(body.files) && body.files.length > MAX_FILES_PER_BATCH) {
      return NextResponse.json({ error: `Upload no more than ${MAX_FILES_PER_BATCH} files in one batch.` }, { status: 400 });
    }

    for (const file of files) {
      if (!file || typeof file.name !== "string" || typeof file.size !== "number") {
        return NextResponse.json({ error: "One of the proof files is invalid." }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `${file.name} is larger than 20 MB.` }, { status: 400 });
      }
    }

    const supabase = getSupabaseAdmin();
    const { data: requestRow } = await supabase.from("custom_requests").select("id").eq("id", requestId).single();
    if (!requestRow) return NextResponse.json({ error: "Request not found." }, { status: 404 });

    const uploadTargets: Array<{ index: number; path: string; token: string; name: string }> = [];
    const stamp = Date.now();
    const safeItemKey = sanitizeFileName(itemKey).slice(0, 60);

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const path = `${requestId}/${stamp}-${safeItemKey}-${index}-${sanitizeFileName(file.name)}`;
      const { data, error } = await supabase.storage.from(QUOTE_PROOF_BUCKET).createSignedUploadUrl(path);
      if (error || !data?.token) {
        console.error("Proof signed upload URL failed", error);
        return NextResponse.json({ error: "Could not prepare proof upload." }, { status: 500 });
      }
      uploadTargets.push({ index, path, token: data.token, name: file.name });
    }

    return NextResponse.json({ ok: true, uploads: uploadTargets });
  } catch (error) {
    console.error("Proof upload route failed", error);
    return NextResponse.json({ error: "Could not prepare proof upload." }, { status: 500 });
  }
}
