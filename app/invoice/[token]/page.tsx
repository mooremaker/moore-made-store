import Image from "next/image";
import { notFound } from "next/navigation";
import { PrintDocumentButton } from "@/components/document/PrintDocumentButton";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { paymentMethodLabel } from "@/lib/finance-types";
import { money, type QuoteLineItem } from "@/lib/quote-types";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export const metadata = { title: "Moore Made Invoice", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

type InvoiceQuote = {
  id: string;
  request_id: string;
  public_token: string;
  status: string;
  line_items: QuoteLineItem[];
  setup_fee_cents: number;
  shipping_cents: number;
  tax_cents: number;
  tax_mode: "automatic" | "manual" | "exempt";
  stripe_tax_transaction_id: string | null;
  discount_cents: number;
  subtotal_cents: number;
  total_cents: number;
  payment_terms: "full" | "deposit";
  deposit_amount_cents: number | null;
  notes: string | null;
  responded_at: string | null;
  sent_at: string | null;
  created_at: string;
};

type PaymentRow = {
  id: string;
  amount_cents: number;
  payment_method: string;
  paid_at: string | null;
  created_at: string;
  status: string;
};

function prettyDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(new Date(value));
}

export default async function InvoicePage({ params }: Props) {
  if (!isSupabaseConfigured()) notFound();
  const { token } = await params;
  if (!token) notFound();
  const supabase = getSupabaseAdmin();
  const { data: quoteData } = await supabase.from("quotes").select("id,request_id,public_token,status,line_items,setup_fee_cents,shipping_cents,tax_cents,tax_mode,stripe_tax_transaction_id,discount_cents,subtotal_cents,total_cents,payment_terms,deposit_amount_cents,notes,responded_at,sent_at,created_at").eq("public_token", token).maybeSingle();
  if (!quoteData || quoteData.status !== "approved") notFound();
  const quote = quoteData as unknown as InvoiceQuote;
  const [{ data: order }, { data: paymentData }] = await Promise.all([
    supabase.from("custom_requests").select("request_number,customer_name,email,phone,product,quantity,delivery").eq("id", quote.request_id).single(),
    supabase.from("payments").select("id,amount_cents,payment_method,paid_at,created_at,status").eq("request_id", quote.request_id).eq("status", "paid").order("paid_at", { ascending: true }),
  ]);
  if (!order) notFound();
  const payments = (paymentData ?? []) as PaymentRow[];
  const paidCents = payments.reduce((sum, payment) => sum + Number(payment.amount_cents || 0), 0);
  const totalCents = Number(quote.total_cents || 0);
  const balanceCents = Math.max(0, totalCents - paidCents);
  const invoiceStatus = balanceCents <= 0 ? "PAID" : paidCents > 0 ? "PARTIALLY PAID" : "DUE";
  const orderNumber = formatRequestNumber(order.request_number);
  const invoiceNumber = `INV-${orderNumber}`;
  const lineItems = Array.isArray(quote.line_items) ? quote.line_items : [];
  const issueDate = quote.responded_at || quote.sent_at || quote.created_at;
  const fulfillmentChargeLabel = String(order.delivery || "").toLowerCase().includes("delivery")
    ? "Local delivery"
    : String(order.delivery || "").toLowerCase().includes("ship")
      ? "Shipping"
      : "Fulfillment";

  return (
    <div className="shell invoicePage">
      <div className="invoiceActions"><a className="btn secondary" href="/account">Back to account</a><a className="btn secondary" href={`/quote/${token}`}>Open approved proof</a><PrintDocumentButton label="Print / Save Invoice PDF" /></div>
      <article className="invoicePaper">
        <header className="invoiceHeader">
          <Image src="/moore-made-header-logo.png" width={190} height={63} alt="Moore Made" className="invoiceLogo" priority />
          <div className="invoiceTitle"><span className={`invoiceStatus invoiceStatus-${invoiceStatus.toLowerCase().replace(/\s+/g,"-")}`}>{invoiceStatus}</span><h1>Invoice</h1><p>{invoiceNumber}</p></div>
        </header>
        <div className="invoiceRule" />
        <section className="invoiceMetaGrid">
          <div><span>Bill to</span><strong>{order.customer_name}</strong><small>{order.email}</small>{order.phone ? <small>{order.phone}</small> : null}</div>
          <div><span>Invoice date</span><strong>{prettyDate(issueDate)}</strong></div>
          <div><span>Order</span><strong>{orderNumber}</strong></div>
          <div><span>Fulfillment</span><strong>{order.delivery || "To be confirmed"}</strong></div>
        </section>

        <section className="invoiceSection">
          <div className="invoiceSectionHeading"><div><span className="eyebrow">Approved order</span><h2>Itemized charges</h2></div><small>This invoice reflects the customer-approved proof + quote.</small></div>
          <div className="invoiceLineItems">
            <div className="invoiceLine invoiceLineHeader"><span>Item</span><span>Qty</span><span>Price each</span><span>Line total</span></div>
            {lineItems.map((item, index) => <div className="invoiceLine" key={`${item.description}-${index}`}><span>{item.description}</span><span>{item.quantity}</span><span>{money(item.unitPriceCents)}</span><strong>{money(item.quantity * item.unitPriceCents)}</strong></div>)}
          </div>
          <div className="invoiceTotals">
            <div><span>Items subtotal</span><strong>{money(quote.subtotal_cents)}</strong></div>
            {quote.setup_fee_cents ? <div><span>Setup fee</span><strong>{money(quote.setup_fee_cents)}</strong></div> : null}
            {quote.shipping_cents ? <div><span>{fulfillmentChargeLabel}</span><strong>{money(quote.shipping_cents)}</strong></div> : null}
            {quote.tax_cents ? <div><span>{quote.tax_mode === "automatic" && !quote.stripe_tax_transaction_id ? "Estimated sales tax" : "Sales tax"}</span><strong>{money(quote.tax_cents)}</strong></div> : null}
            {quote.discount_cents ? <div><span>Discount</span><strong>−{money(quote.discount_cents)}</strong></div> : null}
            <div className="invoiceGrandTotal"><span>Invoice total</span><strong>{money(totalCents)}</strong></div>
          </div>
        </section>

        <section className="invoicePaymentSummary">
          <div><span>Total billed</span><strong>{money(totalCents)}</strong></div>
          <div><span>Payments received</span><strong>{money(paidCents)}</strong></div>
          <div className="invoiceBalance"><span>Balance due</span><strong>{money(balanceCents)}</strong></div>
        </section>

        <section className="invoiceTerms">
          <div><span>Payment terms</span><strong>{quote.payment_terms === "deposit" ? `Custom deposit · ${money(quote.deposit_amount_cents || 0)} initial payment` : "Full payment"}</strong></div>
          {quote.notes ? <div><span>Order notes</span><p>{quote.notes}</p></div> : null}
        </section>

        {payments.length ? <section className="invoicePayments"><div className="invoiceSectionHeading"><div><span className="eyebrow">Payment history</span><h2>Payments applied</h2></div></div>{payments.map((payment) => <div className="invoicePaymentRow" key={payment.id}><span>{prettyDate(payment.paid_at || payment.created_at)}</span><span>{paymentMethodLabel(payment.payment_method)}</span><strong>{money(payment.amount_cents)}</strong></div>)}</section> : null}

        <footer className="invoiceFooter"><strong>Moore Made LLC</strong><p>mooremade.store · Custom goods designed and produced by Moore Made.</p><p className="invoiceFinalSale"><span><strong>Custom order — all sales final.</strong> Deposits and payments are non-refundable.</span><span>If there is an issue with your finished order, contact Moore Made so we can help make it right.</span></p></footer>
      </article>
    </div>
  );
}
