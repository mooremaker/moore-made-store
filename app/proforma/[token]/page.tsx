import Image from "next/image";
import { notFound } from "next/navigation";
import { PrintDocumentButton } from "@/components/document/PrintDocumentButton";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { money, QUOTE_STATUS_LABELS, type QuoteLineItem, type QuoteProofItem, type QuoteStatus } from "@/lib/quote-types";
import { QUOTE_PROOF_BUCKET, getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";
import { SavedMockupPreview } from "@/components/mockups/SavedMockupPreview";
import { signMockupDocumentForDisplay } from "@/lib/mockup-display-server";

export const metadata = { title: "Moore Made Pro Forma Invoice + Proof", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

type RequestView = {
  request_number: number;
  customer_name: string;
  product: string;
  quantity: number;
  delivery: string | null;
};

type QuoteView = {
  id: string;
  public_token: string;
  status: QuoteStatus;
  line_items: QuoteLineItem[];
  setup_fee_cents: number;
  shipping_cents: number;
  tax_cents: number;
  tax_mode: "automatic" | "manual" | "exempt";
  discount_cents: number;
  subtotal_cents: number;
  total_cents: number;
  payment_terms: "full" | "deposit";
  deposit_amount_cents: number | null;
  notes: string | null;
  valid_until: string | null;
  proof_paths: string[];
  proof_notes: string | null;
  proof_version: number;
  mockup_snapshot: unknown | null;
  sent_at: string | null;
  created_at: string;
  custom_requests: RequestView | RequestView[];
};

type ProofAssetRow = { id: string; storage_path: string; original_filename: string | null; sort_order: number };
type ProofItemRow = { id: string; quote_id: string; proof_version: number; title: string; notes: string | null; sort_order: number; quote_proof_assets: ProofAssetRow[] | null };

function prettyDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function prettyDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(new Date(value));
}

function assetIsPdf(path: string) {
  return path.toLowerCase().endsWith(".pdf");
}

export default async function ProFormaPage({ params }: Props) {
  if (!isSupabaseConfigured()) notFound();
  const { token } = await params;
  if (!token) notFound();

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("quotes")
    .select("id,public_token,status,line_items,setup_fee_cents,shipping_cents,tax_cents,tax_mode,discount_cents,subtotal_cents,total_cents,payment_terms,deposit_amount_cents,notes,valid_until,proof_paths,proof_notes,proof_version,mockup_snapshot,sent_at,created_at,custom_requests(request_number,customer_name,product,quantity,delivery)")
    .eq("public_token", token)
    .single();

  if (error || !data) notFound();
  const quote = data as unknown as QuoteView;
  const request = Array.isArray(quote.custom_requests) ? quote.custom_requests[0] : quote.custom_requests;
  if (!request) notFound();

  const mockupSnapshot = await signMockupDocumentForDisplay(quote.mockup_snapshot, 3600);

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
    assets: await Promise.all((item.quote_proof_assets ?? []).sort((a, b) => a.sort_order - b.sort_order).map(async (asset) => {
      const { data: signed } = await supabase.storage.from(QUOTE_PROOF_BUCKET).createSignedUrl(asset.storage_path, 3600);
      return { id: asset.id, path: asset.storage_path, originalName: asset.original_filename, sortOrder: asset.sort_order, url: signed?.signedUrl };
    })),
  })));

  if (!proofItems.length && (quote.proof_paths ?? []).length) {
    const legacyAssets = await Promise.all((quote.proof_paths ?? []).map(async (path, index) => {
      const { data: signed } = await supabase.storage.from(QUOTE_PROOF_BUCKET).createSignedUrl(path, 3600);
      return { path, originalName: path.split("/").pop() || `Proof ${index + 1}`, sortOrder: index, url: signed?.signedUrl };
    }));
    proofItems = [{ id: `legacy-${quote.id}`, proofVersion: quote.proof_version || 1, title: request.product || "Order proof", notes: quote.proof_notes, sortOrder: 0, assets: legacyAssets }];
  }

  const orderNumber = formatRequestNumber(request.request_number);
  const issueDate = quote.sent_at || quote.created_at;
  const lineItems = Array.isArray(quote.line_items) ? quote.line_items : [];
  const fulfillmentChargeLabel = String(request.delivery || "").toLowerCase().includes("delivery")
    ? "Local delivery"
    : String(request.delivery || "").toLowerCase().includes("ship")
      ? "Shipping"
      : "Fulfillment";

  return (
    <div className="shell proformaPage">
      <div className="proformaActions">
        <a className="btn secondary" href={`/quote/${token}`}>Back to proof + quote</a>
        <PrintDocumentButton label="Print / Save Pro Forma PDF" />
      </div>

      <article className="proformaPaper">
        <header className="proformaHeader">
          <Image src="/moore-made-header-logo.png" width={190} height={63} alt="Moore Made" className="proformaLogo" priority />
          <div className="proformaTitle">
            <span className="proformaBadge">PRO FORMA · NOT A RECEIPT</span>
            <h1>Pro Forma + Proof</h1>
            <p>{orderNumber}</p>
          </div>
        </header>

        <div className="proformaRule" />

        <section className="proformaMetaGrid">
          <div><span>Prepared for</span><strong>{request.customer_name}</strong></div>
          <div><span>Issue date</span><strong>{prettyDateTime(issueDate)}</strong></div>
          <div><span>Quote status</span><strong>{QUOTE_STATUS_LABELS[quote.status]}</strong></div>
          <div><span>Valid through</span><strong>{prettyDate(quote.valid_until)}</strong></div>
          <div><span>Proof version</span><strong>Version {Math.max(1, Number(quote.proof_version || 1))}</strong></div>
          <div><span>Requested quantity</span><strong>{request.quantity}</strong></div>
          <div><span>Fulfillment</span><strong>{request.delivery || "To be confirmed"}</strong></div>
        </section>

        <section className="proformaSection">
          <div className="proformaSectionHeading"><div><span className="eyebrow">Pricing</span><h2>Complete quote</h2></div><small>Preliminary document for approval; not proof of payment.</small></div>
          <div className="proformaLineItems">
            <div className="proformaLine proformaLineHeader"><span>Item</span><span>Qty</span><span>Price each</span><span>Line total</span></div>
            {lineItems.map((item, index) => (
              <div className="proformaLine" key={`${item.description}-${index}`}>
                <span>{item.description}</span>
                <span>{item.quantity}</span>
                <span>{money(item.unitPriceCents)}</span>
                <strong>{money(item.quantity * item.unitPriceCents)}</strong>
              </div>
            ))}
          </div>

          <div className="proformaTotals">
            <div><span>Items subtotal</span><strong>{money(quote.subtotal_cents)}</strong></div>
            {quote.setup_fee_cents ? <div><span>Setup fee</span><strong>{money(quote.setup_fee_cents)}</strong></div> : null}
            {quote.shipping_cents ? <div><span>{fulfillmentChargeLabel}</span><strong>{money(quote.shipping_cents)}</strong></div> : null}
            {quote.tax_cents ? <div><span>{quote.tax_mode === "automatic" ? "Estimated sales tax" : "Sales tax"}</span><strong>{money(quote.tax_cents)}</strong></div> : null}
            {quote.discount_cents ? <div><span>Discount</span><strong>−{money(quote.discount_cents)}</strong></div> : null}
            <div className="proformaGrandTotal"><span>{quote.tax_mode === "automatic" ? "Estimated pro forma total" : "Pro forma total"}</span><strong>{money(quote.total_cents)}</strong></div>
          </div>

          <div className="proformaPaymentTerms">
            <span>Payment terms</span>
            {quote.payment_terms === "deposit" ? (
              <div><strong>Custom deposit: {money(quote.deposit_amount_cents || 0)}</strong><small>Estimated balance after deposit: {money(Math.max(0, quote.total_cents - (quote.deposit_amount_cents || 0)))}</small></div>
            ) : (
              <div><strong>Full payment required</strong><small>{money(quote.total_cents)} is due after approval to begin production.</small></div>
            )}
          </div>
          {quote.notes ? <div className="proformaNotes"><span>Production / quote notes</span><p>{quote.notes}</p></div> : null}
        </section>

        <section className="proformaSection proformaProofSection">
          <div className="proformaSectionHeading"><div><span className="eyebrow">Mockups / proof</span><h2>Design approval set</h2></div><small>{proofItems.length} product/proof item{proofItems.length === 1 ? "" : "s"}</small></div>
          {mockupSnapshot ? <SavedMockupPreview document={mockupSnapshot} title="Frozen approval mockup" className="proformaSavedMockup" /> : null}
          {proofItems.length ? <div className="proformaProofList">
            {proofItems.map((item, itemIndex) => (
              <article className="proformaProofItem" key={item.id}>
                <div className="proformaProofHead"><div><span>{String(itemIndex + 1).padStart(2, "0")}</span><h3>{item.title}</h3></div><small>{item.assets.length} file{item.assets.length === 1 ? "" : "s"}</small></div>
                {item.assets.length ? <div className="proformaProofGrid">
                  {item.assets.map((asset, assetIndex) => assetIsPdf(asset.path) ? (
                    <a className="proformaPdfTile" href={asset.url} target="_blank" rel="noreferrer" key={`${asset.path}-${assetIndex}`}><strong>PDF PROOF</strong><span>{asset.originalName || `Proof ${assetIndex + 1}`}</span></a>
                  ) : asset.url ? (
                    <a href={asset.url} target="_blank" rel="noreferrer" key={`${asset.path}-${assetIndex}`}><img src={asset.url} alt={`${item.title} proof ${assetIndex + 1}`} /></a>
                  ) : null)}
                </div> : itemIndex === 0 && mockupSnapshot ? <p className="proformaMissingProof">This item uses the frozen saved mockup shown above.</p> : <p className="proformaMissingProof">No proof file is attached to this item.</p>}
                {item.notes ? <div className="proformaProofNotes"><span>Design notes</span><p>{item.notes}</p></div> : null}
              </article>
            ))}
          </div> : mockupSnapshot ? null : <p className="proformaMissingProof">No mockup/proof files are attached to this quote yet.</p>}
        </section>

        <footer className="proformaFooter">
          <strong>This is a pro forma document, not a payment receipt.</strong>
          <p>It summarizes the quoted work and the proof version presented for approval. Final production should follow the approved proof + quote.</p>
          <small>Moore Made LLC · mooremade.store · {orderNumber}</small>
        </footer>
      </article>
    </div>
  );
}
