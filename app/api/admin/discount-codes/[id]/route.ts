import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { normalizeDiscountCode } from "@/lib/discount-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type RouteProps = { params: Promise<{ id: string }> };
function text(value: unknown, max = 500) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function integerOrNull(value: unknown) { if (value === null || value === undefined || value === "") return null; const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : null; }
function cents(value: unknown) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; }

export async function PATCH(request: Request, { params }: RouteProps) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    if (body.action === "retire") {
      const { error } = await supabase.from("discount_codes").update({ active: false, retired_at: new Date().toISOString() }).eq("id", id);
      if (error) return NextResponse.json({ error: "Could not retire the discount code." }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "toggle") {
      const { error } = await supabase.from("discount_codes").update({ active: body.active === true }).eq("id", id).is("retired_at", null);
      if (error) return NextResponse.json({ error: "Could not update the discount code." }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    const code = normalizeDiscountCode(text(body.code, 80));
    const kind = body.kind === "fixed" ? "fixed" : "percent";
    const percentOff = kind === "percent" ? Number(body.percentOff || 0) : null;
    const amountOffCents = kind === "fixed" ? cents(body.amountOffCents) : null;
    if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code)) return NextResponse.json({ error: "Use 2–40 letters, numbers, dashes, or underscores for the code." }, { status: 400 });
    if (kind === "percent" && (!percentOff || percentOff <= 0 || percentOff > 100)) return NextResponse.json({ error: "Percent discount must be greater than 0 and no more than 100%." }, { status: 400 });
    if (kind === "fixed" && (!amountOffCents || amountOffCents <= 0)) return NextResponse.json({ error: "Fixed discount must be greater than $0." }, { status: 400 });

    const { error } = await supabase.from("discount_codes").update({
      code,
      description: text(body.description, 500) || null,
      kind,
      percent_off: percentOff,
      amount_off_cents: amountOffCents,
      min_order_cents: cents(body.minOrderCents),
      max_uses: integerOrNull(body.maxUses),
      per_customer_limit: integerOrNull(body.perCustomerLimit),
      starts_at: text(body.startsAt, 40) || null,
      expires_at: text(body.expiresAt, 40) || null,
      active: body.active === true,
    }).eq("id", id).is("retired_at", null);
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "That discount code already exists." }, { status: 409 });
      return NextResponse.json({ error: "Could not update the discount code." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Discount code update failed", error);
    return NextResponse.json({ error: "Could not update the discount code." }, { status: 500 });
  }
}
