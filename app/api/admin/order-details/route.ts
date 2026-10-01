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
    .select("id,quantity,status,payment_status,order_items,colors").eq("id", id).single();
  if (currentError || !current) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (!["new", "reviewing"].includes(current.status) || current.payment_status !== "unpaid") {
    return NextResponse.json({ error: "Order details are locked after approval or payment begins." }, { status: 409 });
  }
  if (parsed.count !== current.quantity) {
    return NextResponse.json({ error: `Size quantities total ${parsed.count}; the order quantity is ${current.quantity}. Correct the breakdown before saving.` }, { status: 400 });
  }
  // Do not allow the editable summary to contradict saved structured production items.
  const items = Array.isArray(current.order_items) ? current.order_items : [];
  if (items.length) {
    const normalizeSize = (size: string) => {
      const key = size.toLowerCase().replace(/[^a-z0-9]/g, "");
      return ({ medium: "m", large: "l", xlarge: "xl", xxl: "2xl", xxxl: "3xl", "3xltall": "3xlt", "18months": "18m", "18month": "18m" } as Record<string, string>)[key] || key;
    };
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!item || typeof item !== "object" || !item.quantities || typeof item.quantities !== "object") return NextResponse.json({ error: "Structured order items need to be reviewed separately." }, { status: 409 });
      for (const [size, amount] of Object.entries(item.quantities as Record<string, unknown>)) {
        const qty = Number(amount);
        if (!Number.isSafeInteger(qty) || qty < 0) return NextResponse.json({ error: "Structured order quantities are invalid." }, { status: 409 });
        const key = normalizeSize(size);
        counts.set(key, (counts.get(key) || 0) + qty);
      }
    }
    const summary = new Map<string, number>();
    for (const line of parsed.normalized.split("\n")) {
      const [size, amount] = line.split(/:\s*(?=\d+$)/);
      const key = normalizeSize(size);
      summary.set(key, (summary.get(key) || 0) + Number(amount));
    }
    if (Array.from(counts).some(([size, qty]) => qty !== (summary.get(size) || 0)) || Array.from(summary).some(([size, qty]) => qty !== (counts.get(size) || 0))) {
      return NextResponse.json({ error: "This size breakdown differs from the saved structured product quantities. Edit the individual products before changing the summary." }, { status: 409 });
    }
    if (items.length > 1 && body.colors.trim() !== (current.colors || "")) {
      return NextResponse.json({ error: "Change individual product colors in the full item editor before updating a multi-product order." }, { status: 409 });
    }
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
    ...(items.length === 1 && body.colors.trim() ? { order_items: [{ ...items[0], colorName: body.colors.trim() }] } : {}),
  }).eq("id", id);
  if (error) {
    console.error("Admin order detail correction failed", error);
    return NextResponse.json({ error: "Could not save corrected order details." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, sizes: parsed.normalized });
}
