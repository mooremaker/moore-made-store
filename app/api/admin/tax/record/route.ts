import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const quoteId = text(body.quoteId, 100);
    if (!quoteId) return NextResponse.json({ error: "Quote not found." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select("id,request_id,total_cents,tax_cents,tax_mode,stripe_tax_calculation_id,stripe_tax_transaction_id")
      .eq("id", quoteId)
      .single();
    if (quoteError || !quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });

    if (quote.stripe_tax_transaction_id) {
      return NextResponse.json({ ok: true, transactionId: quote.stripe_tax_transaction_id, alreadyRecorded: true });
    }
    if (quote.tax_mode !== "automatic" || Number(quote.tax_cents || 0) <= 0) {
      return NextResponse.json({ error: "This quote does not have automatically calculated tax to record." }, { status: 409 });
    }
    if (!quote.stripe_tax_calculation_id) {
      return NextResponse.json({ error: "The saved Stripe Tax calculation is missing. Keep this sale in the tax ledger and contact support before attempting a repair." }, { status: 409 });
    }

    const { data: payments, error: paymentsError } = await supabase
      .from("payments")
      .select("amount_cents,status")
      .eq("quote_id", quote.id);
    if (paymentsError) return NextResponse.json({ error: "Could not verify the paid amount." }, { status: 500 });
    const paidCents = (payments ?? []).filter((row) => row.status === "paid").reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
    if (paidCents < Number(quote.total_cents || 0)) {
      return NextResponse.json({ error: "Stripe Tax is recorded after the order has been paid in full." }, { status: 409 });
    }

    const transaction = await getStripe().tax.transactions.createFromCalculation(
      {
        calculation: quote.stripe_tax_calculation_id,
        reference: `order-${quote.request_id}`,
        metadata: { quote_id: quote.id, request_id: quote.request_id, repair_source: "admin" },
      },
      { idempotencyKey: `moore-made-tax-${quote.id}` },
    );

    const { error: updateError } = await supabase
      .from("quotes")
      .update({ stripe_tax_transaction_id: transaction.id })
      .eq("id", quote.id)
      .is("stripe_tax_transaction_id", null);
    if (updateError) throw new Error("Stripe recorded the tax, but the transaction ID could not be saved to this order.");

    return NextResponse.json({ ok: true, transactionId: transaction.id });
  } catch (error) {
    console.error("Stripe Tax transaction repair failed", error);
    const message = error instanceof Error ? error.message : "Could not record this Stripe Tax transaction.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
