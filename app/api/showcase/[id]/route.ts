import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const MAX_FILES = 5;
const text = (value: unknown, max = 4000) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function owner(id: string) {
  const auth = await createSupabaseServerClient();
  const { data: authData } = await auth.auth.getUser();
  const user = authData.user;
  if (!user) return { error: NextResponse.json({ error: "Please sign in first." }, { status: 401 }) };
  const admin = getSupabaseAdmin();
  const { data: post } = await admin.from("showcase_posts")
    .select("id,customer_user_id,status,published_snapshot,photo_paths,published_photo_paths")
    .eq("id", id).maybeSingle();
  if (!post || post.customer_user_id !== user.id) return { error: NextResponse.json({ error: "Review not found." }, { status: 404 }) };
  return { user, admin, post };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await owner(id);
  if ("error" in access) return access.error;
  const { admin, post } = access;
  const body = await request.json().catch(() => ({}));
  const action = body.action === "submit" ? "submit" : "draft";
  const name = text(body.name, 160);
  const email = text(body.email, 320).toLowerCase();
  const product = text(body.product, 300);
  const review = text(body.review, 4000);
  const rating = Number(body.rating || 5);
  const permission = body.permission === true;
  const keepPaths = Array.isArray(body.keepPaths) ? body.keepPaths.filter((p: unknown): p is string => typeof p === "string" && p.startsWith(`${id}/`)) : [];
  const currentPaths: string[] = Array.isArray(post.photo_paths) ? post.photo_paths.filter((p: unknown): p is string => typeof p === "string") : [];
  const validKeepPaths = keepPaths.filter((p: string) => currentPaths.includes(p)).slice(0, MAX_FILES);

  if (action === "submit") {
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !product || !review || !permission || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Complete the required fields and permission checkbox before submitting." }, { status: 400 });
    }
  }

  const { error } = await admin.from("showcase_posts").update({
    customer_name: name || "Draft",
    business_name: text(body.businessName, 240) || null,
    email: email || access.user?.email || "",
    product: product || "Untitled review",
    rating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? Math.round(rating) : 5,
    review,
    caption: text(body.caption, 4000) || null,
    social_handle: text(body.socialHandle, 160) || null,
    display_permission: permission,
    photo_paths: validKeepPaths,
    status: action === "submit" ? "pending" : "draft",
    submitted_at: action === "submit" ? new Date().toISOString() : null,
    approved_at: null,
  }).eq("id", id).eq("customer_user_id", access.user!.id);
  if (error) return NextResponse.json({ error: "Could not save your review." }, { status: 500 });

  const removed = currentPaths.filter((path: string) => !validKeepPaths.includes(path));
  if (removed.length) await admin.storage.from("showcase-files").remove(removed);
  return NextResponse.json({ ok: true, status: action === "submit" ? "pending" : "draft" });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await owner(id);
  if ("error" in access) return access.error;
  const { admin, post, user } = access;
  const draftPaths: string[] = Array.isArray(post.photo_paths)
    ? post.photo_paths.filter((path: unknown): path is string => typeof path === "string")
    : [];
  const publishedPaths: string[] = Array.isArray(post.published_photo_paths)
    ? post.published_photo_paths.filter((path: unknown): path is string => typeof path === "string")
    : [];
  const allPaths = [...new Set<string>([...draftPaths, ...publishedPaths])];
  const { error } = await admin.from("showcase_posts").delete().eq("id", id).eq("customer_user_id", user!.id);
  if (error) return NextResponse.json({ error: "Could not remove your review." }, { status: 500 });
  if (allPaths.length) await admin.storage.from("showcase-files").remove(allPaths);
  return NextResponse.json({ ok: true });
}
