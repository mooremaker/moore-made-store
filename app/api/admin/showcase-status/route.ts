import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const allowed = new Set(["pending", "approved", "rejected"]);
export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json();
  if (typeof body.id !== "string" || !allowed.has(body.status)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { error } = await getSupabaseAdmin().from("showcase_posts").update({ status: body.status, approved_at: body.status === "approved" ? new Date().toISOString() : null }).eq("id", body.id);
  if (error) return NextResponse.json({ error: "Could not update post" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
