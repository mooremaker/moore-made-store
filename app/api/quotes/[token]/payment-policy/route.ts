import { NextResponse } from "next/server";
import {
  FINAL_SALE_POLICY_ACKNOWLEDGMENTS,
  FINAL_SALE_POLICY_SNAPSHOT,
  FINAL_SALE_POLICY_TITLE,
  FINAL_SALE_POLICY_VERSION,
} from "@/lib/payment-policy";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const body = await request.json().catch(() => ({}));

    const accepted = FINAL_SALE_POLICY_ACKNOWLEDGMENTS.every((item) => body?.[item.key] === true);
    if (!accepted) {
      return NextResponse.json({ error: "Please review and accept every required custom-order term before continuing to payment." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select("id,request_id,status,proof_version")
      .eq("public_token", token)
      .single();

    if (quoteError || !quote) return NextResponse.json({ error: "This approved order could not be found." }, { status: 404 });
    if (quote.status !== "approved") {
      return NextResponse.json({ error: "Approve the final proof + quote before accepting payment terms." }, { status: 409 });
    }

    const proofVersion = Math.max(1, Number(quote.proof_version || 1));
    const { data: existing, error: existingError } = await supabase
      .from("order_policy_acceptances")
      .select("id,accepted_at")
      .eq("quote_id", quote.id)
      .eq("proof_version", proofVersion)
      .eq("policy_version", FINAL_SALE_POLICY_VERSION)
      .maybeSingle();

    if (existingError) {
      console.error("Payment policy lookup failed", existingError);
      return NextResponse.json({ error: "Payment terms are not set up yet. Please contact Moore Made." }, { status: 503 });
    }
    if (existing) return NextResponse.json({ ok: true, acceptedAt: existing.accepted_at, alreadyAccepted: true });

    const userAgent = (request.headers.get("user-agent") || "").slice(0, 1000) || null;
    const { data: acceptance, error: insertError } = await supabase
      .from("order_policy_acceptances")
      .insert({
        request_id: quote.request_id,
        quote_id: quote.id,
        proof_version: proofVersion,
        policy_version: FINAL_SALE_POLICY_VERSION,
        policy_title: FINAL_SALE_POLICY_TITLE,
        policy_snapshot: FINAL_SALE_POLICY_SNAPSHOT,
        acceptance_source: "public_quote",
        user_agent: userAgent,
      })
      .select("id,accepted_at")
      .single();

    if (insertError || !acceptance) {
      console.error("Payment policy acceptance insert failed", insertError);
      return NextResponse.json({ error: "Could not save your acceptance. Please try again before paying." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, acceptedAt: acceptance.accepted_at });
  } catch (error) {
    console.error("Payment policy acceptance failed", error);
    return NextResponse.json({ error: "Could not save your payment terms acceptance." }, { status: 500 });
  }
}
