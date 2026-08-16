import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function DELETE(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Invalid post." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: post, error: readError } = await supabase.from("showcase_posts").select("photo_paths").eq("id", id).maybeSingle();
  if (readError) return NextResponse.json({ error: "Could not load this post." }, { status: 500 });

  const paths = Array.isArray(post?.photo_paths) ? post.photo_paths : [];
  if (paths.length) await supabase.storage.from("showcase-files").remove(paths);
  const { error } = await supabase.from("showcase_posts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Could not delete this post." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
