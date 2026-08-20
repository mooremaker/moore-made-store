import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  if (typeof body.id !== "string" || typeof body.featured !== "boolean") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: post, error: readError } = await admin
    .from("showcase_posts")
    .select("id,status")
    .eq("id", body.id)
    .maybeSingle();

  if (readError || !post) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  if (body.featured && post.status !== "approved") {
    return NextResponse.json({ error: "Approve this review before featuring it on the homepage." }, { status: 400 });
  }

  if (body.featured) {
    const { error: clearError } = await admin
      .from("showcase_posts")
      .update({ homepage_featured: false })
      .eq("homepage_featured", true);
    if (clearError) return NextResponse.json({ error: "Could not replace the current homepage review." }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from("showcase_posts")
    .update({ homepage_featured: body.featured })
    .eq("id", body.id);

  if (updateError) return NextResponse.json({ error: "Could not update the homepage review." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
