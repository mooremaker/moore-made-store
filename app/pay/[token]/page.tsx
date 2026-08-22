import { notFound } from "next/navigation";
import { SharedPaymentCheckout } from "@/components/SharedPaymentCheckout";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { money } from "@/lib/quote-types";
import { hashPaymentShareToken } from "@/lib/payment-share";
import { nextPaymentAmount, type PaymentTerms } from "@/lib/payment-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const metadata = { title: "Pay your Moore Made order", robots: { index: false, follow: false } };

export default async function SharedPaymentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) notFound();
  const supabase = getSupabaseAdmin();
  const hash = hashPaymentShareToken(token);
  const { data: link } = await supabase
    .from("payment_share_links")
    .select("id,request_id,quote_id,active,expires_at,revoked_at,recipient_email,quotes(id,status,total_cents,payment_terms,deposit_amount_cents,custom_requests(request_number,customer_name,product))")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!link || !link.active || link.revoked_at || (link.expires_at && new Date(link.expires_at).getTime() < Date.now())) notFound();
  const quote = Array.isArray(link.quotes) ? link.quotes[0] : link.quotes;
  if (!quote || quote.status !== "approved") notFound();
  const order = Array.isArray(quote.custom_requests) ? quote.custom_requests[0] : quote.custom_requests;
  if (!order) notFound();

  const { data: paidRows } = await supabase.from("payments").select("amount_cents,status").eq("quote_id", quote.id);
  const amountPaid = (paidRows ?? []).filter((row) => row.status === "paid").reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
  const next = nextPaymentAmount({ totalCents: Number(quote.total_cents || 0), terms: (quote.payment_terms === "deposit" ? "deposit" : "full") as PaymentTerms, depositAmountCents: quote.deposit_amount_cents, amountPaidCents: amountPaid });
  const reference = formatRequestNumber(order.request_number);

  return (
    <div className="shell sharedPaymentPage">
      <section className="sharedPaymentCard card">
        <div className="eyebrow">Secure Moore Made payment</div>
        <h1>{reference}</h1>
        <p>This order remains under <strong>{order.customer_name}</strong>. You can pay it on their behalf; your payer details will be recorded separately.</p>
        <div className="sharedPaymentSummary">
          <div><span>Order</span><strong>{order.product}</strong></div>
          <div><span>Total</span><strong>{money(Number(quote.total_cents || 0))}</strong></div>
          <div><span>Paid already</span><strong>{money(amountPaid)}</strong></div>
          <div><span>Amount due now</span><strong>{money(next.amountCents)}</strong></div>
        </div>
        {next.amountCents > 0 ? <SharedPaymentCheckout shareToken={token} amountCents={next.amountCents} initialEmail={link.recipient_email || ""} /> : <div className="quoteResponseSuccess"><strong>Paid in full ✓</strong><p>No balance remains on this order.</p></div>}
        <p className="sharedPaymentPrivacy">Only the approved customer-facing order total is shown here. Internal Moore Made costs and notes are never shared.</p>
      </section>
    </div>
  );
}
