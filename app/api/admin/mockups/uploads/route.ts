import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin, MOCKUP_STUDIO_BUCKET } from "@/lib/supabase-admin";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 25;

function text(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeName(name: string) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 120) || "mockup-file";
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const requestId = text(body.requestId, 100);
    const purpose = text(body.purpose, 60) || "asset";
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES) : [];
    if (!requestId || files.length === 0) return NextResponse.json({ error: "Choose at least one image." }, { status: 400 });
    if (Array.isArray(body.files) && body.files.length > MAX_FILES) return NextResponse.json({ error: `Upload no more than ${MAX_FILES} files at once.` }, { status: 400 });

    for (const file of files) {
      if (!file || typeof file.name !== "string" || typeof file.size !== "number") return NextResponse.json({ error: "One of the files is invalid." }, { status: 400 });
      if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: `${file.name} is larger than 20 MB.` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: order } = await supabase.from("custom_requests").select("id").eq("id", requestId).single();
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

    const stamp = Date.now();
    const uploads: Array<{ index: number; path: string; token: string; name: string }> = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const path = `${requestId}/${stamp}-${safeName(purpose)}-${index}-${safeName(file.name)}`;
      const { data, error } = await supabase.storage.from(MOCKUP_STUDIO_BUCKET).createSignedUploadUrl(path);
      if (error || !data?.token) {
        console.error("Mockup signed upload failed", error);
        return NextResponse.json({ error: "Could not prepare the mockup upload." }, { status: 500 });
      }
      uploads.push({ index, path, token: data.token, name: file.name });
    }
    return NextResponse.json({ ok: true, uploads });
  } catch (error) {
    console.error("Mockup upload route failed", error);
    return NextResponse.json({ error: "Could not prepare the mockup upload." }, { status: 500 });
  }
}
