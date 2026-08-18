import { notFound } from "next/navigation";
import { QuoteResponseButtons } from "@/components/QuoteResponseButtons";
import { PaymentCheckoutButton } from "@/components/PaymentCheckoutButton";
import { CashPaymentRequestButton } from "@/components/CashPaymentRequestButton";
import { PaymentPolicyGate } from "@/components/PaymentPolicyGate";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { money, QUOTE_STATUS_LABELS, type QuoteLineItem, type QuoteProofItem, type QuoteStatus } from "@/lib/quote-types";
import { QUOTE_PROOF_BUCKET, getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";
import { nextPaymentAmount, paymentStatusLabel, type PaymentStatus, type PaymentTerms } from "@/lib/payment-types";
import { syncPaidCheckoutSessionById } from "@/lib/payment-server";
import { isStripeConfigured } from "@/lib/stripe";
import { FINAL_SALE_POLICY_VERSION } from "@/lib/payment-policy";

export const metadata = { robots: { index: false, follow: false } };

type PageProps = { params: Promise<{ token: string }>; searchParams: Promise<{ payment?: string; session_id?: string }> };

type RequestView = {
  id: string;
  request_number: number;
  customer_name: string;
  product: string;
  quantity: number;
  item_type: string | null;
  colors: string | null;
  sizes: string | null;
  logo_size: string | null;
  print_sides: string | null;
  placements: string[] | null;
  deadline: string | null;
  delivery: string | null;
  payment_status: PaymentStatus;
  amount_paid_cents: number;
  cash_payment_request_status: "none" | "pending" | "contacted" | "completed" | "cancelled";
  cash_payment_requested_at: string | null;
  cash_payment_requested_amount_cents: number | null;
};

type QuoteView = {
  id: string;
  public_token: string;
  status: QuoteStatus;
  line_items: QuoteLineItem[];
  setup_fee_cents: number;
  shipping_cents: number;
  tax_cents: number;
  discount_cents: number;
  subtotal_cents: number;
  total_cents: number;
  payment_terms: PaymentTerms;
  deposit_amount_cents: number | null;
  notes: string | null;
  valid_until: string | null;
  proof_paths: string[];
  proof_notes: string | null;
  proof_version: number;
  customer_change_request: string | null;
  sent_at: string | null;
  custom_requests: RequestView | RequestView[];
};

type ProofAssetRow = { id:string; storage_path:string; original_filename:string|null; sort_order:number; };
type ProofItemRow = { id:string; quote_id:string; proof_version:number; title:string; notes:string|null; sort_order:number; quote_proof_assets:ProofAssetRow[]|null; };

function prettyPlacement(value: string) {
  return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function prettyDate(value: string | null) {
  if (!value) return "Not specified";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function assetIsPdf(path: string) {
  return path.toLowerCase().endsWith(".pdf");
}

export default async function QuotePage({ params, searchParams }: PageProps) {
  if (!isSupabaseConfigured()) notFound();
  const { token } = await params;
  const query = await searchParams;
  if (query.payment === "success" && query.session_id && isStripeConfigured()) {
    try { await syncPaidCheckoutSessionById(query.session_id); } catch (error) { console.error("Stripe return sync failed", error); }
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("quotes")
    .select("id,public_token,status,line_items,setup_fee_cents,shipping_cents,tax_cents,discount_cents,subtotal_cents,total_cents,payment_terms,deposit_amount_cents,notes,valid_until,proof_paths,proof_notes,proof_version,customer_change_request,sent_at,custom_requests(id,request_number,customer_name,product,quantity,item_type,colors,sizes,logo_size,print_sides,placements,deadline,delivery,payment_status,amount_paid_cents,cash_payment_request_status,cash_payment_requested_at,cash_payment_requested_amount_cents)")
    .eq("public_token", token)
    .single();

  if (error || !data) notFound();
  const quote = data as unknown as QuoteView;
  const request = Array.isArray(quote.custom_requests) ? quote.custom_requests[0] : quote.custom_requests;
  if (!request) notFound();

  const { data: proofData } = await supabase
    .from("quote_proof_items")
    .select("id,quote_id,proof_version,title,notes,sort_order,quote_proof_assets(id,storage_path,original_filename,sort_order)")
    .eq("quote_id", quote.id)
    .eq("proof_version", Math.max(1, Number(quote.proof_version || 1)))
    .order("sort_order", { ascending: true });

  const proofRows = (proofData ?? []) as unknown as ProofItemRow[];
  let proofItems: QuoteProofItem[] = await Promise.all(proofRows.map(async (item) => ({
    id: item.id,
    quoteId: item.quote_id,
    proofVersion: item.proof_version,
    title: item.title,
    notes: item.notes,
    sortOrder: item.sort_order,
    assets: await Promise.all((item.quote_proof_assets ?? []).sort((a,b) => a.sort_order - b.sort_order).map(async (asset) => {
      const { data: signed } = await supabase.storage.from(QUOTE_PROOF_BUCKET).createSignedUrl(asset.storage_path, 3600);
      return { id: asset.id, path: asset.storage_path, originalName: asset.original_filename, sortOrder: asset.sort_order, url: signed?.signedUrl };
    })),
  })));

  // Backward compatibility for a proof sent with the earlier 6-file version.
  if (!proofItems.length && (quote.proof_paths ?? []).length) {
    const legacyAssets = await Promise.all((quote.proof_paths ?? []).map(async (path, index) => {
      const { data: signed } = await supabase.storage.from(QUOTE_PROOF_BUCKET).createSignedUrl(path, 3600);
      return { path, originalName: path.split("/").pop() || `Proof ${index + 1}`, sortOrder: index, url: signed?.signedUrl };
    }));
    proofItems = [{ id: `legacy-${quote.id}`, proofVersion: quote.proof_version || 1, title: request.product || "Order proof", notes: quote.proof_notes, sortOrder: 0, assets: legacyAssets }];
  }

  const totalProofFiles = proofItems.reduce((sum, item) => sum + item.assets.length, 0);
  const allProofsAvailable = proofItems.length > 0 && proofItems.every((item) => item.assets.length > 0 && item.assets.every((asset) => Boolean(asset.url)));
  const isPastDue = quote.valid_until ? Date.now() > new Date(`${quote.valid_until}T23:59:59`).getTime() : false;
  const active = quote.status === "sent" && !isPastDue && allProofsAvailable;
  const shownStatus = isPastDue && quote.status === "sent" ? "Expired" : QUOTE_STATUS_LABELS[quote.status];

  const amountPaidCents = Math.max(0, Number(request.amount_paid_cents || 0));
  const paymentStep = nextPaymentAmount({
    totalCents: Number(quote.total_cents || 0),
    terms: quote.payment_terms === "deposit" ? "deposit" : "full",
    depositAmountCents: quote.deposit_amount_cents,
    amountPaidCents,
  });
  const paymentLabel = paymentStep.kind === "deposit" ? "Pay deposit" : paymentStep.kind === "balance" ? "Pay remaining balance" : "Pay full amount";
  const cashAppConfigured = Boolean((process.env.CASHAPP_PAYMENT_URL || "").trim());
  const paymentReference = formatRequestNumber(request.request_number);
  const currentProofVersion = Math.max(1, Number(quote.proof_version || 1));
  const { data: policyAcceptance, error: policyAcceptanceError } = await supabase
    .from("order_policy_acceptances")
    .select("id,accepted_at")
    .eq("quote_id", quote.id)
    .eq("proof_version", currentProofVersion)
    .eq("policy_version", FINAL_SALE_POLICY_VERSION)
    .maybeSingle();
  const paymentPolicyReady = !policyAcceptanceError;
  const paymentPolicyAccepted = Boolean(policyAcceptance);

  return (
    <div className="shell publicQuoteShell proofApprovalPage scalableProofApprovalPage">
      <section className="pageHero quotePageHero">
        <div className="eyebrow">Final proof + quote</div>
        <h1>{formatRequestNumber(request.request_number)}</h1>
        <p className="lead">Hi {request.customer_name}, review every product mockup and the complete pricing below. Approve the whole order once, or request changes only for the item(s) that need them.</p>
        <div className="quoteDocumentLinks"><a className="btn secondary" href={`/proforma/${token}`} target="_blank" rel="noreferrer">Pro Forma + Proof ↗</a>{quote.status === "approved" ? <a className="btn secondary" href={`/invoice/${token}`} target="_blank" rel="noreferrer">Invoice ↗</a> : null}</div>
      </section>

      <section className="card publicQuoteCard proofApprovalCard">
        <div className="publicQuoteHead">
          <div><span>Approval status</span><strong>{shownStatus}</strong></div>
          <div><span>Proof version</span><strong>Version {quote.proof_version || 1}</strong></div>
          <div><span>Proof set</span><strong>{proofItems.length} item{proofItems.length === 1 ? "" : "s"} · {totalProofFiles} file{totalProofFiles === 1 ? "" : "s"}</strong></div>
          {quote.valid_until ? <div><span>Valid through</span><strong>{prettyDate(quote.valid_until)}</strong></div> : null}
        </div>

        <section className="publicProofSection scalablePublicProofSection">
          <div className="publicProofSectionHead"><div><span className="eyebrow">01 · Product proofs</span><h2>Review every final design</h2><p>Each product is grouped separately so you can confirm all views before approving the order.</p></div></div>

          {proofItems.length ? <div className="publicProofItemList">
            {proofItems.map((item, itemIndex) => <article className="publicProofProduct" key={item.id}>
              <div className="publicProofProductHead"><div><span>{String(itemIndex + 1).padStart(2, "0")}</span><h3>{item.title}</h3></div><small>{item.assets.length} file{item.assets.length === 1 ? "" : "s"}</small></div>
              {item.assets.length ? <div className="publicProofGrid">
                {item.assets.map((asset, assetIndex) => <a href={asset.url} target="_blank" rel="noreferrer" className="publicProofItem" key={`${asset.path}-${assetIndex}`}>
                  {assetIsPdf(asset.path) ? <div className="publicProofPdf"><strong>PDF PROOF</strong><span>{asset.originalName || `Open file ${assetIndex + 1}`} ↗</span></div> : <img src={asset.url} alt={`${item.title} proof ${assetIndex + 1}`} />}
                </a>)}
              </div> : <div className="quoteInactiveMessage">A proof file is missing for this item. Please contact Moore Made before approving.</div>}
              {item.notes ? <div className="publicProofNotes"><span>Design notes</span><p>{item.notes}</p></div> : null}
            </article>)}
          </div> : <div className="quoteInactiveMessage">The proof files are temporarily unavailable. Please contact Moore Made before approving.</div>}
        </section>

        <section className="publicProofSection">
          <div className="publicProofSectionHead"><div><span className="eyebrow">02 · Original request</span><h2>Confirm the overall order details</h2></div></div>
          <dl className="publicOrderDetails">
            <div><dt>Original request</dt><dd>{request.product}</dd></div>
            <div><dt>Total quantity</dt><dd>{request.quantity}</dd></div>
            <div><dt>Style / item</dt><dd>{request.item_type || "Not specified"}</dd></div>
            <div><dt>Color(s)</dt><dd>{request.colors || "Not specified"}</dd></div>
            <div><dt>Front / back</dt><dd>{request.print_sides || "Not specified"}</dd></div>
            <div><dt>Placement</dt><dd>{request.placements?.length ? request.placements.map(prettyPlacement).join(" · ") : "Not specified"}</dd></div>
            <div><dt>Design size</dt><dd>{request.logo_size || "Not specified"}</dd></div>
            <div><dt>Pickup / shipping</dt><dd>{request.delivery || "Not specified"}</dd></div>
            <div><dt>Requested date</dt><dd>{prettyDate(request.deadline)}</dd></div>
            {request.sizes ? <div className="publicOrderDetailsWide"><dt>Sizes / quantities</dt><dd><pre>{request.sizes}</pre></dd></div> : null}
          </dl>
          {proofItems.length > 1 ? <p className="fieldHelp">The product proofs above and the quote below are the final approval set. They may include additional or more specific items than the customer&apos;s original request description.</p> : null}
        </section>

        <section className="publicProofSection">
          <div className="publicProofSectionHead"><div><span className="eyebrow">03 · Price</span><h2>Review the complete quote</h2></div></div>
          <div className="publicQuoteLines">
            <div className="publicQuoteLine publicQuoteLineHeader"><span>Item</span><span>Qty</span><span>Total</span></div>
            {quote.line_items.map((item, index) => <div className="publicQuoteLine" key={`${item.description}-${index}`}><span>{item.description}</span><span>{item.quantity}</span><strong>{money(item.quantity * item.unitPriceCents)}</strong></div>)}
          </div>

          <div className="publicQuoteTotals">
            <div><span>Items subtotal</span><strong>{money(quote.subtotal_cents)}</strong></div>
            {quote.setup_fee_cents ? <div><span>Setup fee</span><strong>{money(quote.setup_fee_cents)}</strong></div> : null}
            {quote.shipping_cents ? <div><span>Shipping</span><strong>{money(quote.shipping_cents)}</strong></div> : null}
            {quote.tax_cents ? <div><span>Tax</span><strong>{money(quote.tax_cents)}</strong></div> : null}
            {quote.discount_cents ? <div><span>Discount</span><strong>−{money(quote.discount_cents)}</strong></div> : null}
            <div className="publicQuoteGrandTotal"><span>Total</span><strong>{money(quote.total_cents)}</strong></div>
          </div>
          <div className="publicPaymentTermsSummary">
            <span>Payment terms</span>
            {quote.payment_terms === "deposit" ? <div><strong>Custom deposit: {money(quote.deposit_amount_cents || 0)}</strong><small>Remaining after deposit: {money(Math.max(0, quote.total_cents - (quote.deposit_amount_cents || 0)))}</small></div> : <div><strong>Full payment required</strong><small>{money(quote.total_cents)} is due after approval to begin production.</small></div>}
          </div>
          {quote.notes ? <div className="publicQuoteNotes"><span>Production / quote notes</span><p>{quote.notes}</p></div> : null}
        </section>

        <section className="publicProofSection publicApprovalSection">
          <div className="publicProofSectionHead"><div><span className="eyebrow">04 · Approval</span><h2>Approve the entire order once</h2></div></div>
          <p className="publicApprovalIntro">If every proof and the pricing are correct, approve everything below. If only one item needs work, identify that specific product in the change request instead of restarting the entire conversation.</p>
          {active ? <QuoteResponseButtons token={token} proofItems={proofItems.map((item) => ({ id: item.id, title: item.title }))} /> : <div className="quoteInactiveMessage">{quote.status === "approved" ? "This complete proof + quote is approved. Complete the payment step below to keep the order moving." : quote.status === "changes_requested" ? "Your change request was received. Moore Made will update the affected proof(s) and send a new complete version when it is ready." : quote.status === "declined" ? "This quote was declined. Contact Moore Made if you'd like an updated version." : !allProofsAvailable && quote.status === "sent" ? "One or more proof files are unavailable, so approval is temporarily disabled. Please contact Moore Made." : "This approval is no longer active. Contact Moore Made if you need an updated proof + quote."}</div>}
        </section>

        {quote.status === "approved" ? <section className="publicProofSection publicPaymentSection">
          <div className="publicProofSectionHead"><div><span className="eyebrow">05 · Payment</span><h2>Complete your payment</h2></div></div>
          {query.payment === "success" ? <div className="quoteResponseSuccess"><strong>Payment received ✓</strong><p>Your payment has been recorded. Your order status will update automatically.</p></div> : null}
          {query.payment === "cancelled" ? <div className="quoteInactiveMessage">Checkout was cancelled. Nothing was charged; you can try again whenever you&apos;re ready.</div> : null}
          <div className="paymentProgressCard">
            <div><span>Order total</span><strong>{money(quote.total_cents)}</strong></div>
            <div><span>Paid</span><strong>{money(amountPaidCents)}</strong></div>
            <div><span>Remaining</span><strong>{money(Math.max(0, quote.total_cents - amountPaidCents))}</strong></div>
            <div><span>Status</span><strong>{paymentStatusLabel(request.payment_status || "unpaid")}</strong></div>
          </div>
          {paymentStep.amountCents > 0 ? <>
            <p className="publicApprovalIntro">{paymentStep.kind === "deposit" ? `A ${money(paymentStep.amountCents)} custom deposit is required to begin production. The remaining balance stays attached to this order.` : paymentStep.kind === "balance" ? "Your deposit is recorded. Pay the remaining balance before the order can be marked ready for pickup or shipped." : "Full payment is required to begin production."}</p>

            <PaymentPolicyGate
              token={token}
              proofVersion={currentProofVersion}
              policyReady={paymentPolicyReady}
              initialAccepted={paymentPolicyAccepted}
              initialAcceptedAt={policyAcceptance?.accepted_at || null}
            >
              <div className="paymentMethodStack">
                {isStripeConfigured() ? <div className="digitalPaymentPanel digitalPaymentPrimary">
                  <div>
                    <span className="eyebrow">Recommended</span>
                    <h3>Pay securely online</h3>
                    <p>Use Stripe Checkout for the fastest payment confirmation.</p>
                  </div>
                  <PaymentCheckoutButton token={token} amountCents={paymentStep.amountCents} label={paymentLabel} />
                </div> : null}

                {cashAppConfigured ? <div className={`cashAppPaymentPanel ${isStripeConfigured() ? "digitalPaymentSecondary" : ""}`}>
                  <div>
                    <span className="eyebrow">{isStripeConfigured() ? "Alternative digital payment" : "Cash App payment"}</span>
                    <h3>Send {money(paymentStep.amountCents)}</h3>
                    <p>{paymentStep.kind === "deposit" ? "This is the custom deposit required to begin production." : paymentStep.kind === "balance" ? "This is the remaining balance on your order." : "Full payment is required to begin production."}</p>
                  </div>
                  <div className="cashAppReference">
                    <span>Please include this order number in the payment note</span>
                    <strong>{paymentReference}</strong>
                  </div>
                  <a className="btn cashAppPaymentButton" href={`/api/payments/cashapp?token=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer">Pay with Cash App ↗</a>
                </div> : !isStripeConfigured() ? <div className="cashAppPaymentPanel cashAppPaymentPendingSetup">
                  <div>
                    <span className="eyebrow">Digital payment</span>
                    <h3>Cash App link coming shortly</h3>
                    <p>Your approved order and amount due are saved. Moore Made will add its Cash App payment link here before digital payment is requested.</p>
                  </div>
                </div> : null}

                <CashPaymentRequestButton
                  token={token}
                  amountCents={paymentStep.amountCents}
                  initialStatus={request.cash_payment_request_status || "none"}
                />
              </div>
            </PaymentPolicyGate>

            <div className="cashAppNextSteps paymentConfirmationSteps">
              <strong>What happens after payment?</strong>
              <p>Digital payments are confirmed automatically when supported. Cash App or cash payments are verified by Moore Made before the order is marked paid.</p>
              <p>Once payment is recorded, we&apos;ll email a confirmation. When your order is finished, you&apos;ll receive a separate pickup or shipping email, including tracking when available.</p>
            </div>
          </> : <div className="quoteResponseSuccess"><strong>Paid in full ✓</strong><p>No balance remains on this order.</p></div>}
        </section> : null}
      </section>
    </div>
  );
}
