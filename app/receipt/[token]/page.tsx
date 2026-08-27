import Image from "next/image";
import { notFound } from "next/navigation";
import { PrintReceiptButton } from "@/components/receipt/PrintReceiptButton";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { paymentMethodLabel, receiptLabel } from "@/lib/finance-types";
import { money, type QuoteLineItem } from "@/lib/quote-types";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export const metadata = { title: "Moore Made Receipt", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

type ReceiptQuote = {
  public_token: string;
  line_items: QuoteLineItem[];
  setup_fee_cents: number;
  shipping_cents: number;
  tax_cents: number;
  discount_cents: number;
  applied_discount_code: string | null;
  subtotal_cents: number;
  total_cents: number;
  payment_terms: "full" | "deposit";
  deposit_amount_cents: number | null;
};

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
    .select("id,request_id,quote_id,amount_cents,order_tax_cents,order_total_cents,status,payment_method,manual_reference,payer_name,payer_email,paid_at,receipt_number,receipt_token,receipt_order_number,receipt_payment_sequence,voided_at,void_reason")
    .eq("receipt_token", token)
    .in("status", ["paid", "voided"])
    .maybeSingle();
  if (!payment) notFound();

  const [{ data: order }, { data: quoteData }, { data: paidRows }] = await Promise.all([
    supabase.from("custom_requests").select("request_number,customer_name,product,quantity,delivery").eq("id", payment.request_id).single(),
    supabase.from("quotes").select("public_token,line_items,setup_fee_cents,shipping_cents,tax_cents,discount_cents,applied_discount_code,subtotal_cents,total_cents,payment_terms,deposit_amount_cents").eq("id", payment.quote_id).single(),
    supabase.from("payments").select("amount_cents,paid_at,status").eq("request_id", payment.request_id).eq("status", "paid"),
  ]);
  if (!order || !quoteData) notFound();
  const quote = quoteData as unknown as ReceiptQuote;

  const paidAtMs = payment.paid_at ? new Date(payment.paid_at).getTime() : Number.POSITIVE_INFINITY;
  const paidToDate = (paidRows ?? []).reduce((sum, row) => {
    if (row.status !== "paid") return sum;
    const rowTime = row.paid_at ? new Date(row.paid_at).getTime() : 0;
    return rowTime <= paidAtMs ? sum + Number(row.amount_cents || 0) : sum;
  }, 0);
  const totalCents = Number(payment.order_total_cents ?? quote.total_cents ?? 0);
  const receiptTaxCents = Number(payment.order_tax_cents ?? quote.tax_cents ?? 0);
  const remainingCents = Math.max(0, totalCents - paidToDate);
  const orderNumber = formatRequestNumber(order.request_number);
  const receiptNumber = receiptLabel(payment.receipt_number, payment.receipt_order_number || order.request_number, payment.receipt_payment_sequence);
  const lineItems = Array.isArray(quote.line_items) ? quote.line_items : [];
  const fulfillmentChargeLabel = String(order.delivery || "").toLowerCase().includes("delivery")
    ? "Local delivery"
    : String(order.delivery || "").toLowerCase().includes("ship")
      ? "Shipping"
      : "Fulfillment";

  return (
    <div className="shell receiptPage">
      <div className="receiptActions"><a className="btn secondary" href="/account">Back to account</a><a className="btn secondary" href={`/invoice/${quote.public_token}`}>View invoice</a><PrintReceiptButton /></div>
      <article className="receiptPaper">
        <header className="receiptHeader">
          <div><Image src="/moore-made-header-logo.png" width={190} height={63} alt="Moore Made" className="receiptLogo" priority /><div className="customerDocumentTagline">Your Idea. Moore Made.</div></div>
          <div className="receiptTitle"><div className="eyebrow">{payment.status === "voided" ? "Corrected payment record" : "Payment receipt"}</div><h1>{receiptNumber}</h1><p>{dateTime(payment.paid_at)}</p></div>
        </header>

        <div className="receiptRule" />
        {payment.status === "voided" ? <div className="receiptVoidNotice"><strong>VOIDED / CORRECTED</strong><p>This payment record is no longer counted toward the order balance.{payment.void_reason ? ` Reason: ${payment.void_reason}` : ""}</p></div> : null}

        <section className="receiptCustomerGrid">
          <div><span>Customer</span><strong>{order.customer_name}</strong></div>
          <div><span>Order</span><strong>{orderNumber}</strong></div>
          <div><span>Product</span><strong>{order.product}</strong></div>
          <div><span>Requested quantity</span><strong>{order.quantity}</strong></div>
        </section>

        <section className="receiptBreakdownSection">
          <div className="receiptSectionHeading"><div><span className="eyebrow">Order breakdown</span><h2>What this order includes</h2></div><small>Prices reflect the approved quote.</small></div>
          <div className="receiptLineItems">
            <div className="receiptLine receiptLineHeader"><span>Item</span><span>Qty</span><span>Price each</span><span>Line total</span></div>
            {lineItems.map((item, index) => (
              <div className="receiptLine" key={`${item.description}-${index}`}>
                <span>{item.description}</span>
                <span>{item.quantity}</span>
                <span>{money(item.unitPriceCents)}</span>
                <strong>{money(item.quantity * item.unitPriceCents)}</strong>
              </div>
            ))}
          </div>

          <div className="receiptOrderTotals">
            <div><span>Items subtotal</span><strong>{money(quote.subtotal_cents)}</strong></div>
            {quote.setup_fee_cents ? <div><span>Setup fee</span><strong>{money(quote.setup_fee_cents)}</strong></div> : null}
            {quote.shipping_cents ? <div><span>{fulfillmentChargeLabel}</span><strong>{money(quote.shipping_cents)}</strong></div> : null}
            {receiptTaxCents ? <div><span>Sales tax</span><strong>{money(receiptTaxCents)}</strong></div> : null}
            {quote.discount_cents ? <div><span>{quote.applied_discount_code === "MOOREMADE15" ? "Moore Made New Customer Appreciation Discount (15%)" : "Discount"}</span><strong>−{money(quote.discount_cents)}</strong></div> : null}
            <div className="receiptOrderGrandTotal"><span>Order total</span><strong>{money(totalCents)}</strong></div>
          </div>
          <div className="receiptTermsNote">
            <span>Payment terms</span>
            <strong>{quote.payment_terms === "deposit" ? `Custom deposit · ${money(quote.deposit_amount_cents || 0)} initial payment` : "Full payment"}</strong>
          </div>
        </section>

        <section className="receiptPaymentBox">
          <div><span>This payment</span><strong>{money(payment.amount_cents)}</strong></div>
          <div><span>Payment method</span><strong>{paymentMethodLabel(payment.payment_method)}</strong></div>
          {payment.payer_name ? <div><span>Paid by</span><strong>{payment.payer_name}</strong></div> : null}
          {payment.manual_reference ? <div><span>Reference</span><strong>{payment.manual_reference}</strong></div> : null}
          <div><span>Payment date</span><strong>{dateTime(payment.paid_at)}</strong></div>
        </section>

        <section className="receiptTotals">
          <div><span>Order total</span><strong>{money(totalCents)}</strong></div>
          <div><span>This payment</span><strong>{money(payment.amount_cents)}</strong></div>
          <div><span>Total paid through this receipt</span><strong>{money(paidToDate)}</strong></div>
          <div className="receiptBalance"><span>Balance remaining</span><strong>{money(remainingCents)}</strong></div>
        </section>

        <footer className="receiptFooter">
          <strong>Thank you for choosing Moore Made.</strong>
          <p>This receipt confirms the payment above for {orderNumber}. The order breakdown is included so your payment always stays connected to the approved work.</p>
          <p className="receiptFinalSaleNotice"><span><strong>Custom order — all sales final.</strong> Deposits and payments are non-refundable.</span><span>If there is an issue with your finished order, contact Moore Made so we can help make it right.</span></p>
          <small>Moore Made LLC · mooremade.store · Custom Order Terms: /terms/custom-orders</small>
        </footer>
      </article>

      <article className="receiptPrintSheet" aria-label="Printable payment receipt">
        <header className="receiptPrintHeader">
          <Image src="/moore-made-header-logo.png" width={168} height={56} alt="Moore Made" className="receiptPrintLogo" />
          <div className="receiptPrintTitle">
            <span className={`receiptPrintStatus ${payment.status === "voided" ? "isVoided" : "isPaid"}`}>{payment.status === "voided" ? "VOIDED" : "PAID"}</span>
            <strong>PAYMENT RECEIPT</strong>
            <span>{receiptNumber}</span>
            <small>{dateTime(payment.paid_at)}</small>
          </div>
        </header>

        {payment.status === "voided" ? <div className="receiptPrintVoid"><strong>VOIDED / CORRECTED PAYMENT</strong><span>This payment no longer counts toward the order balance.{payment.void_reason ? ` Reason: ${payment.void_reason}` : ""}</span></div> : null}

        <section className="receiptPrintMeta">
          <div><span>Customer</span><strong>{order.customer_name}</strong>{payment.payer_email ? <small>{payment.payer_email}</small> : null}</div>
          <div><span>Order</span><strong>{orderNumber}</strong><small>{order.product} · Qty {order.quantity}</small></div>
        </section>

        <section className="receiptPrintItems">
          <div className="receiptPrintSectionLabel">Order details</div>
          <div className="receiptPrintLine receiptPrintLineHeader"><span>Item</span><span>Qty</span><span>Price each</span><span>Line total</span></div>
          {lineItems.length ? lineItems.map((item, index) => (
            <div className="receiptPrintLine" key={`print-${item.description}-${index}`}>
              <span>{item.description}</span>
              <span>{item.quantity}</span>
              <span>{money(item.unitPriceCents)}</span>
              <strong>{money(item.quantity * item.unitPriceCents)}</strong>
            </div>
          )) : (
            <div className="receiptPrintLine">
              <span>{order.product}</span>
              <span>{order.quantity}</span>
              <span>—</span>
              <strong>{money(quote.subtotal_cents)}</strong>
            </div>
          )}
        </section>

        <section className="receiptPrintSummary">
          <div className="receiptPrintTotals">
            <div><span>Items subtotal</span><strong>{money(quote.subtotal_cents)}</strong></div>
            {quote.setup_fee_cents ? <div><span>Setup fee</span><strong>{money(quote.setup_fee_cents)}</strong></div> : null}
            {quote.shipping_cents ? <div><span>{fulfillmentChargeLabel}</span><strong>{money(quote.shipping_cents)}</strong></div> : null}
            {quote.discount_cents ? <div><span>{quote.applied_discount_code === "MOOREMADE15" ? "Moore Made New Customer Appreciation Discount (15%)" : "Discount"}</span><strong>−{money(quote.discount_cents)}</strong></div> : null}
            {receiptTaxCents ? <div><span>Sales tax</span><strong>{money(receiptTaxCents)}</strong></div> : null}
            <div className="receiptPrintGrandTotal"><span>Order total</span><strong>{money(totalCents)}</strong></div>
          </div>

          <div className="receiptPrintPayment">
            <div className="receiptPrintSectionLabel">Payment</div>
            <div><span>This payment</span><strong>{money(payment.amount_cents)}</strong></div>
            <div><span>Method</span><strong>{paymentMethodLabel(payment.payment_method)}</strong></div>
            {payment.payer_name ? <div><span>Paid by</span><strong>{payment.payer_name}</strong></div> : null}
            {payment.manual_reference ? <div><span>Reference</span><strong>{payment.manual_reference}</strong></div> : null}
            <div><span>Paid through receipt</span><strong>{money(paidToDate)}</strong></div>
            <div className="receiptPrintBalance"><span>Balance remaining</span><strong>{money(remainingCents)}</strong></div>
          </div>
        </section>

        <footer className="receiptPrintFooter">
          <div><strong>Thank you for choosing Moore Made.</strong><span>Your Idea. Moore Made.</span></div>
          <p><span><strong>Custom order — all sales final.</strong> Deposits and payments are non-refundable.</span><span>If there is an issue with your finished order, contact Moore Made so we can help make it right.</span></p>
          <small>Moore Made LLC · mooremade.store · Order {orderNumber}</small>
        </footer>
      </article>
    </div>
  );
}
