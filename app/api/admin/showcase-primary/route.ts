import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  if (typeof body.id !== "string" || typeof body.primary !== "boolean") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: post, error: readError } = await admin
    .from("showcase_posts")
    .select("id,status,customer_user_id,email")
    .eq("id", body.id)
    .maybeSingle();

  if (readError || !post) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  if (body.primary && post.status !== "approved") {
    return NextResponse.json({ error: "Approve this review before making it the customer's main review." }, { status: 400 });
  }

  if (body.primary) {
    let clearQuery = admin.from("showcase_posts").update({ customer_primary: false });
    clearQuery = post.customer_user_id
      ? clearQuery.eq("customer_user_id", post.customer_user_id)
      : clearQuery.ilike("email", post.email.trim());
    const { error: clearError } = await clearQuery;
    if (clearError) return NextResponse.json({ error: "Could not replace this customer's main review." }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from("showcase_posts")
    .update({ customer_primary: body.primary })
    .eq("id", body.id);

  if (updateError) return NextResponse.json({ error: "Could not update the main customer review." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
