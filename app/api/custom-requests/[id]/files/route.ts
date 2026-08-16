import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const submissionToken = typeof body.submissionToken === "string" ? body.submissionToken : "";
    const paths = Array.isArray(body.paths)
      ? body.paths.filter((path: unknown): path is string => typeof path === "string" && path.startsWith(`${id}/`)).slice(0, 8)
      : [];

    if (!id || !submissionToken) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("custom_requests")
      .update({ artwork_paths: paths })
      .eq("id", id)
      .eq("submission_token", submissionToken);

    if (error) {
      console.error("Artwork path update failed", error);
      return NextResponse.json({ error: "Could not attach artwork files." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Artwork completion route error", error);
    return NextResponse.json({ error: "Could not attach artwork files." }, { status: 500 });
  }
}
