import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function parseSizes(input: string): { normalized: string; count: number } | null {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 60) return null;
  const seen = new Set<string>();
  const result: string[] = [];
  let count = 0;
  for (const line of lines) {
    const match = line.match(/^(?:[-*]\s*)?(.+?)\s*:\s*(\d+)$/);
    if (!match) return null;
    const size = match[1].trim();
    const qty = Number(match[2]);
    if (!size || size.length > 60 || seen.has(size.toLowerCase()) || !Number.isSafeInteger(qty) || qty < 1 || qty > 10000) return null;
    seen.add(size.toLowerCase());
    result.push(`${size}: ${qty}`);
    count += qty;
  }
  return { normalized: result.join("\n"), count };
}

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Order is required." }, { status: 400 });
  if (typeof body.sizes !== "string" || body.sizes.length > 3000) return NextResponse.json({ error: "Enter a valid size breakdown." }, { status: 400 });
  const parsed = parseSizes(body.sizes);
  if (!parsed) return NextResponse.json({ error: "Enter one size per line, for example XL: 3." }, { status: 400 });
  if (typeof body.colors !== "string" || body.colors.length > 120 || typeof body.print_sides !== "string" || body.print_sides.length > 80 || typeof body.placements !== "string" || body.placements.length > 300) {
    return NextResponse.json({ error: "One of the order fields is too long or invalid." }, { status: 400 });
  }
  const placements = body.placements.split(",").map((value: string) => value.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
  if (placements.length > 8 || placements.some((value: string) => value.length > 60)) return NextResponse.json({ error: "Enter up to eight placements." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: current, error: currentError } = await supabase.from("custom_requests")
    .select("id,quantity,status,payment_status,order_items").eq("id", id).single();
  if (currentError || !current) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (!["new", "reviewing"].includes(current.status) || current.payment_status !== "unpaid") {
    return NextResponse.json({ error: "Order details are locked after approval or payment begins." }, { status: 409 });
  }
  if (Array.isArray(current.order_items) && current.order_items.length) {
    return NextResponse.json({ error: "Structured product items need a separate item-by-item edit to avoid conflicting quantities." }, { status: 409 });
  }
  if (parsed.count !== current.quantity) {
    return NextResponse.json({ error: `Size quantities total ${parsed.count}; the order quantity is ${current.quantity}. Correct the breakdown before saving.` }, { status: 400 });
  }
  const { data: quotes, error: quoteError } = await supabase.from("quotes").select("status").eq("request_id", id);
  if (quoteError) return NextResponse.json({ error: "Could not verify quote status." }, { status: 500 });
  if ((quotes ?? []).some((quote) => quote.status !== "draft")) {
    return NextResponse.json({ error: "A quote has already been sent. Make a formal revision instead of silently changing the order." }, { status: 409 });
  }

  const { error } = await supabase.from("custom_requests").update({
    sizes: parsed.normalized,
    colors: body.colors.trim() || null,
    print_sides: body.print_sides.trim() || null,
    placements,
  }).eq("id", id);
  if (error) {
    console.error("Admin order detail correction failed", error);
    return NextResponse.json({ error: "Could not save corrected order details." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, sizes: parsed.normalized });
}
