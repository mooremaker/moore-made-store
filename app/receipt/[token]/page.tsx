import Image from "next/image";
import { notFound } from "next/navigation";
import { PrintReceiptButton } from "@/components/receipt/PrintReceiptButton";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { paymentMethodLabel, receiptLabel } from "@/lib/finance-types";
import { money } from "@/lib/quote-types";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export const metadata = { title: "Moore Made Receipt", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export default async function ReceiptPage({ params }: Props) {
  if (!isSupabaseConfigured()) notFound();
  const { token } = await params;
  if (!token) notFound();

  const supabase = getSupabaseAdmin();
  const { data: payment } = await supabase
    .from("payments")
    .select("id,request_id,quote_id,amount_cents,status,payment_method,manual_reference,paid_at,receipt_number,receipt_token")
    .eq("receipt_token", token)
    .eq("status", "paid")
    .maybeSingle();
  if (!payment) notFound();

  const [{ data: order }, { data: quote }, { data: paidRows }] = await Promise.all([
    supabase.from("custom_requests").select("request_number,customer_name,product,quantity").eq("id", payment.request_id).single(),
    supabase.from("quotes").select("total_cents").eq("id", payment.quote_id).single(),
    supabase.from("payments").select("amount_cents,paid_at,status").eq("request_id", payment.request_id).eq("status", "paid"),
  ]);
  if (!order || !quote) notFound();

  const paidAtMs = payment.paid_at ? new Date(payment.paid_at).getTime() : Number.POSITIVE_INFINITY;
  const paidToDate = (paidRows ?? []).reduce((sum, row) => {
    if (row.status !== "paid") return sum;
    const rowTime = row.paid_at ? new Date(row.paid_at).getTime() : 0;
    return rowTime <= paidAtMs ? sum + Number(row.amount_cents || 0) : sum;
  }, 0);
  const totalCents = Number(quote.total_cents || 0);
  const remainingCents = Math.max(0, totalCents - paidToDate);
  const orderNumber = formatRequestNumber(order.request_number);

  return (
    <div className="shell receiptPage">
      <div className="receiptActions"><a className="btn secondary" href="/account">Back to account</a><PrintReceiptButton /></div>
      <article className="receiptPaper">
        <header className="receiptHeader">
          <Image src="/moore-made-header-logo.png" width={1741} height={576} alt="Moore Made" className="receiptLogo" priority />
          <div className="receiptTitle"><div className="eyebrow">Payment receipt</div><h1>{receiptLabel(payment.receipt_number)}</h1><p>{dateTime(payment.paid_at)}</p></div>
        </header>

        <div className="receiptRule" />

        <section className="receiptCustomerGrid">
          <div><span>Customer</span><strong>{order.customer_name}</strong></div>
          <div><span>Order</span><strong>{orderNumber}</strong></div>
          <div><span>Product</span><strong>{order.product}</strong></div>
          <div><span>Quantity</span><strong>{order.quantity}</strong></div>
        </section>

        <section className="receiptPaymentBox">
          <div><span>Payment received</span><strong>{money(payment.amount_cents)}</strong></div>
          <div><span>Payment method</span><strong>{paymentMethodLabel(payment.payment_method)}</strong></div>
          {payment.manual_reference ? <div><span>Reference</span><strong>{payment.manual_reference}</strong></div> : null}
        </section>

        <section className="receiptTotals">
          <div><span>Order total</span><strong>{money(totalCents)}</strong></div>
          <div><span>Paid through this receipt</span><strong>{money(paidToDate)}</strong></div>
          <div className="receiptBalance"><span>Balance remaining</span><strong>{money(remainingCents)}</strong></div>
        </section>

        <footer className="receiptFooter">
          <strong>Thank you for choosing Moore Made.</strong>
          <p>This receipt confirms a payment recorded for {orderNumber}. Keep it for your records.</p>
          <small>Moore Made LLC · mooremade.store</small>
        </footer>
      </article>
    </div>
  );
}
