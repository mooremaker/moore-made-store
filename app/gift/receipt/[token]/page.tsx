import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
function money(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
export default async function GiftReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data } = await getSupabaseAdmin().from("support_gifts").select("donor_name,donor_email,gross_amount_cents,currency,status,stripe_payment_intent_id,paid_at,acknowledgement_text").eq("receipt_token", token).eq("status", "paid").maybeSingle();
  if (!data) notFound();
  return <main className="giftReceiptPage"><article className="giftReceipt"><header><div className="giftBrand"><strong>MOORE<span>/</span>MADE</strong><small>Your Idea. Moore Made.</small></div><span>Paid</span></header><div className="giftReceiptTitle"><p>VOLUNTARY GIFT RECEIPT</p><h1>Thank you for supporting Moore Made.</h1></div><dl><div><dt>Received from</dt><dd>{data.donor_name}<small>{data.donor_email}</small></dd></div><div><dt>Date received</dt><dd>{new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/New_York" }).format(new Date(data.paid_at))}</dd></div><div><dt>Gift amount</dt><dd>{money(Number(data.gross_amount_cents || 0))}</dd></div><div><dt>Payment ID</dt><dd className="giftReceiptId">{data.stripe_payment_intent_id}</dd></div></dl><section><strong>Gift acknowledgement</strong><p>{data.acknowledgement_text}</p><p>Moore Made LLC is a for-profit company. No goods or services were provided in exchange for this payment, and it is not represented as tax-deductible.</p></section><footer><strong>Moore Made LLC</strong><span>Questions? Reply to your receipt email or visit mooremade.store.</span></footer></article></main>;
}
