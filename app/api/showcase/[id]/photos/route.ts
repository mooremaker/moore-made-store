import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const BUCKET = "showcase-files";
const MAX_PHOTOS = 5;
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);
function safeName(value: string) { return (value.split(/[\\/]/).pop() || "photo").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100) || "photo"; }

async function ownedPost(id: string) {
  const auth = await createSupabaseServerClient();
  const { data } = await auth.auth.getUser();
  if (!data.user) return null;
  const admin = getSupabaseAdmin();
  const { data: post } = await admin.from("showcase_posts").select("id,customer_user_id,photo_paths").eq("id", id).maybeSingle();
  if (!post || post.customer_user_id !== data.user.id) return null;
  return { admin, post };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedPost(id);
  if (!owned) return NextResponse.json({ error: "Review not found." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const files = Array.isArray(body.files) ? body.files : [];
  const existing = Array.isArray(owned.post.photo_paths) ? owned.post.photo_paths : [];
  if (!files.length) return NextResponse.json({ uploads: [] });
  if (existing.length + files.length > MAX_PHOTOS) return NextResponse.json({ error: `Reviews can have up to ${MAX_PHOTOS} photos.` }, { status: 400 });
  const uploads: { index:number; path:string; token:string }[] = [];
  for (let index = 0; index < files.length; index++) {
    const f = files[index] || {};
    const name = typeof f.name === "string" ? f.name : "photo";
    const size = typeof f.size === "number" ? f.size : 0;
    const type = typeof f.type === "string" ? f.type.toLowerCase() : "";
    if (!ALLOWED_TYPES.has(type) || size <= 0 || size > MAX_FILE_SIZE) return NextResponse.json({ error: `${name} is not a supported image or is larger than 15 MB.` }, { status: 400 });
    const path = `${id}/customer-${Date.now()}-${randomUUID()}-${safeName(name)}`;
    const { data, error } = await owned.admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) return NextResponse.json({ error: "Could not prepare the photo upload." }, { status: 500 });
    uploads.push({ index, path, token: data.token });
  }
  return NextResponse.json({ uploads });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedPost(id);
  if (!owned) return NextResponse.json({ error: "Review not found." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const paths = Array.isArray(body.paths) ? body.paths.filter((p: unknown): p is string => typeof p === "string" && p.startsWith(`${id}/`)) : [];
  const current = Array.isArray(owned.post.photo_paths) ? owned.post.photo_paths : [];
  const next = [...new Set([...current, ...paths])].slice(0, MAX_PHOTOS);
  const { error } = await owned.admin.from("showcase_posts").update({ photo_paths: next }).eq("id", id).eq("customer_user_id", owned.post.customer_user_id);
  if (error) return NextResponse.json({ error: "Could not attach your photos." }, { status: 500 });
  return NextResponse.json({ ok: true, photo_paths: next });
}
