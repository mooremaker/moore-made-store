import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const submissionToken = typeof body.submissionToken === "string" ? body.submissionToken : "";
    const paths = Array.isArray(body.paths) ? body.paths.filter((p: unknown): p is string => typeof p === "string" && p.startsWith(`${id}/`)).slice(0, 5) : [];
    if (!id || !submissionToken) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const { error } = await getSupabaseAdmin().from("showcase_posts").update({ photo_paths: paths }).eq("id", id).eq("submission_token", submissionToken);
    if (error) return NextResponse.json({ error: "Could not attach photos." }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not attach photos." }, { status: 500 });
  }
}
