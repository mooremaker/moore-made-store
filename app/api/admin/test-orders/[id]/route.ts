import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { CUSTOM_REQUEST_BUCKET, QUOTE_PROOF_BUCKET, getSupabaseAdmin } from "@/lib/supabase-admin";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Order id is required." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: order, error: orderError } = await supabase
    .from("custom_requests")
    .select("id,status,customer_user_id,email,artwork_paths")
    .eq("id", id)
    .maybeSingle();

  if (orderError || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.status !== "cancelled") return NextResponse.json({ error: "Only cancelled test orders can be permanently deleted." }, { status: 409 });
  const adminEmail = (auth.user.email || "").trim().toLowerCase();
  const ownsOrder = order.customer_user_id === auth.user.id || (adminEmail && order.email.trim().toLowerCase() === adminEmail);
  if (!ownsOrder) return NextResponse.json({ error: "You can only permanently delete test orders created with your own admin account or email." }, { status: 403 });

  const [{ count: paidPaymentCount }, { data: quotes }] = await Promise.all([
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("request_id", id).in("status", ["paid", "refunded"]),
    supabase.from("quotes").select("proof_paths").eq("request_id", id),
  ]);

  if ((paidPaymentCount ?? 0) > 0) {
    return NextResponse.json({ error: "This order has a completed or refunded payment, so it must stay in the business records. Void a mistaken manual record first; Stripe records cannot be deleted here." }, { status: 409 });
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

  const proofPaths = (quotes ?? []).flatMap((quote) => Array.isArray(quote.proof_paths) ? quote.proof_paths : []).filter((value): value is string => typeof value === "string" && Boolean(value));
  if (proofPaths.length) {
    const { error: proofStorageError } = await supabase.storage.from(QUOTE_PROOF_BUCKET).remove(proofPaths);
    if (proofStorageError) console.error("Deleted test order but could not remove one or more proof files", proofStorageError);
  }

  return NextResponse.json({ ok: true });
}
