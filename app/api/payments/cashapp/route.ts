import { NextRequest, NextResponse } from "next/server";
import { FINAL_SALE_POLICY_VERSION } from "@/lib/payment-policy";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  try {
    const token = (request.nextUrl.searchParams.get("token") || "").trim();
    if (!token) return NextResponse.json({ error: "Payment link is invalid." }, { status: 400 });

    const cashAppUrl = (process.env.CASHAPP_PAYMENT_URL || "").trim();
    if (!cashAppUrl) return NextResponse.json({ error: "Cash App is not configured yet." }, { status: 503 });
    if (!/^https:\/\//i.test(cashAppUrl)) return NextResponse.json({ error: "Cash App payment link is not configured correctly." }, { status: 503 });

    const supabase = getSupabaseAdmin();
    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select("id,status,proof_version")
      .eq("public_token", token)
      .single();
    if (quoteError || !quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    if (quote.status !== "approved") return NextResponse.json({ error: "Approve the proof + quote before paying." }, { status: 409 });

    const { data: acceptance, error: acceptanceError } = await supabase
      .from("order_policy_acceptances")
      .select("id")
      .eq("quote_id", quote.id)
      .eq("proof_version", Math.max(1, Number(quote.proof_version || 1)))
      .eq("policy_version", FINAL_SALE_POLICY_VERSION)
      .maybeSingle();

    if (acceptanceError || !acceptance) {
      return NextResponse.json({ error: "Accept the final-sale custom-order terms before opening Cash App." }, { status: 409 });
    }

    return NextResponse.redirect(cashAppUrl, 303);
  } catch (error) {
    console.error("Cash App redirect failed", error);
    return NextResponse.json({ error: "Could not open Cash App payment." }, { status: 500 });
  }
}
