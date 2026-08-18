import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { normalizeShowcasePhotoPreview, normalizeShowcasePhotoPreviewMap } from "@/lib/showcase-photo-preview";

const BUCKET = "showcase-files";
const MAX_PHOTOS = 5;
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

function safeName(value: string) {
  const base = value.split(/[\\/]/).pop() || "photo";
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-100) || "photo";
}

async function loadPost(id: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("showcase_posts").select("id,photo_paths,photo_preview_settings").eq("id", id).maybeSingle();
  return { supabase, post: data, error };
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  const files = Array.isArray(body.files) ? body.files : [];
  if (!id || files.length === 0) return NextResponse.json({ error: "Choose at least one photo." }, { status: 400 });

  const { supabase, post, error } = await loadPost(id);
  if (error || !post) return NextResponse.json({ error: "Could not load this review." }, { status: 404 });

  const currentPaths: string[] = Array.isArray(post.photo_paths) ? post.photo_paths.filter((p: unknown): p is string => typeof p === "string") : [];
  const available = Math.max(0, MAX_PHOTOS - currentPaths.length);
  if (available === 0) return NextResponse.json({ error: `This review already has ${MAX_PHOTOS} photos. Remove one before adding another.` }, { status: 400 });
  if (files.length > available) return NextResponse.json({ error: `You can add ${available} more photo${available === 1 ? "" : "s"}.` }, { status: 400 });

  const uploads = [] as { index: number; path: string; token: string }[];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index] as { name?: unknown; size?: unknown; type?: unknown };
    const name = typeof file.name === "string" ? file.name : "photo";
    const size = typeof file.size === "number" ? file.size : 0;
    const type = typeof file.type === "string" ? file.type.toLowerCase() : "";
    if (!ALLOWED_TYPES.has(type)) return NextResponse.json({ error: `${name} is not a supported image type.` }, { status: 400 });
    if (size <= 0 || size > MAX_FILE_SIZE) return NextResponse.json({ error: `${name} must be 15 MB or smaller.` }, { status: 400 });

    const path = `${id}/admin-${Date.now()}-${randomUUID()}-${safeName(name)}`;
    const { data, error: uploadError } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (uploadError || !data?.token) return NextResponse.json({ error: "Could not prepare the photo upload." }, { status: 500 });
    uploads.push({ index, path, token: data.token });
  }

  return NextResponse.json({ uploads });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Invalid review." }, { status: 400 });

  const { supabase, post, error } = await loadPost(id);
  if (error || !post) return NextResponse.json({ error: "Could not load this review." }, { status: 404 });
  const currentPaths: string[] = Array.isArray(post.photo_paths) ? post.photo_paths.filter((p: unknown): p is string => typeof p === "string") : [];

  // Save non-destructive preview framing for one existing photo. The original
  // stored file is never cropped or modified.
  if (typeof body.path === "string" && body.preview && typeof body.preview === "object") {
    const path = body.path;
    if (!currentPaths.includes(path)) return NextResponse.json({ error: "That photo is no longer attached to this review." }, { status: 404 });
    const preview = normalizeShowcasePhotoPreview(body.preview);
    const previewMap = normalizeShowcasePhotoPreviewMap(post.photo_preview_settings);
    const nextPreviewMap = { ...previewMap, [path]: preview };
    const { error: previewError } = await supabase.from("showcase_posts").update({ photo_preview_settings: nextPreviewMap }).eq("id", id);
    if (previewError) return NextResponse.json({ error: "Could not save the photo preview framing. Make sure the latest review-preview migration has been run." }, { status: 500 });
    return NextResponse.json({ ok: true, path, preview });
  }

  const paths = Array.isArray(body.paths)
    ? body.paths.filter((p: unknown): p is string => typeof p === "string" && p.startsWith(`${id}/`))
    : [];
  if (paths.length === 0) return NextResponse.json({ error: "No uploaded photos were provided." }, { status: 400 });

  const uniqueNew = paths.filter((path: string) => !currentPaths.includes(path));
  const nextPaths = [...currentPaths, ...uniqueNew].slice(0, MAX_PHOTOS);

  const { error: updateError } = await supabase.from("showcase_posts").update({ photo_paths: nextPaths }).eq("id", id);
  if (updateError) return NextResponse.json({ error: "Could not attach the new photos to this review." }, { status: 500 });

  const previewMap = normalizeShowcasePhotoPreviewMap(post.photo_preview_settings);
  const photoLinks = (await Promise.all(nextPaths.map(async (path) => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    return data?.signedUrl ? { path, url: data.signedUrl, preview: previewMap[path] ?? { x: 50, y: 50, zoom: 1 } } : null;
  }))).filter(Boolean);

  return NextResponse.json({ ok: true, photoLinks });
}

export async function DELETE(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  const path = typeof body.path === "string" ? body.path : "";
  if (!id || !path || !path.startsWith(`${id}/`)) return NextResponse.json({ error: "Invalid photo." }, { status: 400 });

  const { supabase, post, error } = await loadPost(id);
  if (error || !post) return NextResponse.json({ error: "Could not load this review." }, { status: 404 });
  const currentPaths: string[] = Array.isArray(post.photo_paths) ? post.photo_paths.filter((p: unknown): p is string => typeof p === "string") : [];
  if (!currentPaths.includes(path)) return NextResponse.json({ error: "That photo is no longer attached to this review." }, { status: 404 });
  const nextPaths = currentPaths.filter((item) => item !== path);
  const previewMap = normalizeShowcasePhotoPreviewMap(post.photo_preview_settings);
  delete previewMap[path];

  const { error: updateError } = await supabase.from("showcase_posts").update({ photo_paths: nextPaths, photo_preview_settings: previewMap }).eq("id", id);
  if (updateError) return NextResponse.json({ error: "Could not remove the photo from this review." }, { status: 500 });

  const { error: storageError } = await supabase.storage.from(BUCKET).remove([path]);
  if (storageError) {
    return NextResponse.json({ ok: true, warning: "The photo was removed from the review, but the stored file could not be deleted automatically." });
  }
  return NextResponse.json({ ok: true });
}
