import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const allowed = new Set(["pending", "approved", "rejected"]);
export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json();
  if (typeof body.id !== "string" || !allowed.has(body.status)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: post } = await admin.from("showcase_posts")
    .select("id,customer_name,business_name,product,rating,review,caption,social_handle,photo_paths")
    .eq("id", body.id).maybeSingle();
  if (!post) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: body.status,
    approved_at: body.status === "approved" ? now : null,
  };
  if (body.status === "rejected") {
    update.homepage_featured = false;
  }
  if (body.status === "approved") {
    update.published_snapshot = {
      customer_name: post.customer_name,
      business_name: post.business_name,
      product: post.product,
      rating: post.rating,
      review: post.review,
      caption: post.caption,
      social_handle: post.social_handle,
    };
    update.published_photo_paths = post.photo_paths ?? [];
    update.published_at = now;
  }

  const { error } = await admin.from("showcase_posts").update(update).eq("id", body.id);
  if (error) return NextResponse.json({ error: "Could not update post" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
