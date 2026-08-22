import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const STATUSES = new Set([
  "not_reviewed",
  "customer_attested",
  "permission_requested",
  "verified",
  "declined",
]);

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const requestId = text(body.requestId, 100);
    const status = text(body.status, 40);
    const note = text(body.note, 3000) || null;

    if (!requestId) return NextResponse.json({ error: "Order is required." }, { status: 400 });
    if (!STATUSES.has(status)) return NextResponse.json({ error: "Choose a valid artwork-review status." }, { status: 400 });

    const { data, error } = await getSupabaseAdmin()
      .from("custom_requests")
      .update({
        artwork_rights_review_status: status,
        artwork_rights_review_note: note,
        artwork_rights_reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Artwork-rights review save failed", error);
      return NextResponse.json({ error: "Could not save the artwork review. Run the latest database patch and try again." }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Artwork-rights review route failed", error);
    return NextResponse.json({ error: "Could not save the artwork review." }, { status: 500 });
  }
}
