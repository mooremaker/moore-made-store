import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { CUSTOM_REQUEST_BUCKET, getSupabaseAdmin } from "@/lib/supabase-admin";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Order id is required." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: order, error: orderError } = await supabase
    .from("custom_requests")
    .select("id,status,artwork_paths")
    .eq("id", id)
    .maybeSingle();

  if (orderError || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.status !== "cancelled") return NextResponse.json({ error: "Only cancelled test orders can be permanently deleted." }, { status: 409 });

  const [{ count: paymentCount }, { count: quoteCount }] = await Promise.all([
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("request_id", id),
    supabase.from("quotes").select("id", { count: "exact", head: true }).eq("request_id", id),
  ]);

  if ((paymentCount ?? 0) > 0 || (quoteCount ?? 0) > 0) {
    return NextResponse.json({ error: "This cancelled order has quote or payment history, so it is being kept for business records instead of permanently deleted." }, { status: 409 });
  }

  const { error: deleteError } = await supabase.from("custom_requests").delete().eq("id", id).eq("status", "cancelled");
  if (deleteError) {
    console.error("Test order delete failed", deleteError);
    return NextResponse.json({ error: "Could not delete the test order." }, { status: 500 });
  }

  const artworkPaths = Array.isArray(order.artwork_paths) ? order.artwork_paths.filter((value): value is string => typeof value === "string" && Boolean(value)) : [];
  if (artworkPaths.length) {
    const { error: storageError } = await supabase.storage.from(CUSTOM_REQUEST_BUCKET).remove(artworkPaths);
    if (storageError) console.error("Deleted test order but could not remove one or more artwork files", storageError);
  }

  return NextResponse.json({ ok: true });
}
