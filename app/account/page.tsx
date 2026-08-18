import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/account/ProfileForm";
import { claimVerifiedGuestRecords, getCurrentUser, getUserRole } from "@/lib/auth";
import { formatRequestNumber, REQUEST_STATUS_LABELS, type RequestStatus } from "@/lib/custom-request-types";
import { money, QUOTE_STATUS_LABELS, type QuoteStatus } from "@/lib/quote-types";
import { paymentStatusLabel, type PaymentStatus, type PaymentTerms } from "@/lib/payment-types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CUSTOM_REQUEST_BUCKET, getSupabaseAdmin } from "@/lib/supabase-admin";
import { paymentMethodLabel, receiptLabel } from "@/lib/finance-types";

export const metadata = { robots: { index: false, follow: false } };

type RequestRow = {
  id: string; request_number: number; product: string; quantity: number; status: RequestStatus; deadline: string | null; delivery: string | null; created_at: string; artwork_paths: string[] | null; tracking_number: string | null; tracking_url: string | null; fulfillment_note: string | null; payment_status: PaymentStatus; amount_paid_cents: number;
};
type QuoteRow = { id: string; request_id: string; public_token: string; status: QuoteStatus; total_cents: number; valid_until: string | null; proof_version: number; payment_terms: PaymentTerms; deposit_amount_cents: number | null; };
type ShowcaseRow = { id:string; product:string; rating:number; status:string; created_at:string; published_snapshot:unknown|null; updated_at:string; };
type ReceiptRow = { id:string; request_id:string; amount_cents:number; payment_method:string; paid_at:string|null; created_at:string; receipt_number:number|null; receipt_token:string|null; status:string; };

function dateLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ admin?: string }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/account/login?next=/account");

  await claimVerifiedGuestRecords(user);
  const supabase = await createSupabaseServerClient();
  const [{ data: profile }, { data: requestData }, { data: showcaseData }, { data: messageThreadData }] = await Promise.all([
    supabase.from("profiles").select("full_name,phone").eq("id", user.id).maybeSingle(),
    supabase.from("custom_requests").select("id,request_number,product,quantity,status,deadline,delivery,created_at,artwork_paths,tracking_number,tracking_url,fulfillment_note,payment_status,amount_paid_cents").order("created_at", { ascending: false }),
    supabase.from("showcase_posts").select("id,product,rating,status,created_at,updated_at,published_snapshot").order("updated_at", { ascending: false }),
    supabase.from("message_threads").select("customer_unread_count"),
  ]);

  const requests = (requestData ?? []) as RequestRow[];
  const requestIds = requests.map((row) => row.id);
  const { data: quoteData } = requestIds.length
    ? await supabase.from("quotes").select("id,request_id,public_token,status,total_cents,valid_until,proof_version,payment_terms,deposit_amount_cents").in("request_id", requestIds)
    : { data: [] as QuoteRow[] };
  const quotes = (quoteData ?? []) as QuoteRow[];
  const quoteByRequest = new Map(quotes.map((quote) => [quote.request_id, quote]));
  const { data: paymentData } = requestIds.length
    ? await supabase.from("payments").select("id,request_id,amount_cents,payment_method,paid_at,created_at,receipt_number,receipt_token,status").in("request_id", requestIds).eq("status", "paid").order("paid_at", { ascending: false })
    : { data: [] as ReceiptRow[] };
  const receiptRows = (paymentData ?? []) as ReceiptRow[];
  const receiptsByRequest = new Map<string, ReceiptRow[]>();
  for (const receipt of receiptRows) receiptsByRequest.set(receipt.request_id, [...(receiptsByRequest.get(receipt.request_id) ?? []), receipt]);

  const admin = getSupabaseAdmin();
  const artworkLinks = new Map<string, { name: string; url: string }[]>();
  for (const request of requests) {
    const links: { name: string; url: string }[] = [];
    for (const path of request.artwork_paths ?? []) {
      const { data: signed } = await admin.storage.from(CUSTOM_REQUEST_BUCKET).createSignedUrl(path, 900);
      if (signed?.signedUrl) links.push({ name: path.split("/").pop() ?? "Artwork", url: signed.signedUrl });
    }
    artworkLinks.set(request.id, links);
  }

  const role = await getUserRole(user.id);
  const messageUnread = ((messageThreadData ?? []) as { customer_unread_count:number }[]).reduce((sum, row) => sum + Number(row.customer_unread_count || 0), 0);
  return (
    <div className="shell accountPage">
      <section className="accountHero">
        <div><div className="eyebrow">My Moore Made</div><h1>Your orders.</h1><p>Track requests, proofs, quotes, payments, and fulfillment in one private place.</p></div>
        <div className="accountHeroActions"><Link className="btn secondary" href="/account/messages">Messages{messageUnread ? ` (${messageUnread})` : ""}</Link>{role === "admin" ? <Link className="btn secondary" href="/admin">Open admin</Link> : null}<form action="/api/auth/logout" method="post"><input type="hidden" name="next" value="/" /><button className="btn secondary" type="submit">Sign out</button></form></div>
      </section>

      {params.admin === "denied" ? <div className="formError">This account is signed in, but it is not approved for Moore Made admin access.</div> : null}

      <section className="card accountProfileCard">
        <div className="accountSectionHead"><div><div className="eyebrow">Account</div><h2>Your details</h2></div><span className="accountEmail">{user.email}</span></div>
        <ProfileForm initialName={profile?.full_name ?? ""} initialPhone={profile?.phone ?? ""} />
      </section>

      <section className="accountSection">
        <div className="accountSectionHead"><div><div className="eyebrow">Orders</div><h2>Your Moore Made requests</h2></div><Link className="btn" href="/custom-orders">Start a new request</Link></div>
        {requests.length === 0 ? (
          <div className="empty accountEmpty"><h3>No orders attached yet.</h3><p>Requests placed while signed in appear here automatically. If you previously ordered as a guest using this verified email, eligible requests are attached when you sign in.</p></div>
        ) : (
          <div className="accountOrderList">
            {requests.map((request) => {
              const quote = quoteByRequest.get(request.id);
              const files = artworkLinks.get(request.id) ?? [];
              const receipts = receiptsByRequest.get(request.id) ?? [];
              return (
                <details className="accountOrderCard" key={request.id}>
                  <summary>
                    <div className="accountOrderMain"><strong>{formatRequestNumber(request.request_number)}</strong><span>{request.product}</span></div>
                    <div className="accountOrderMeta"><span className={`statusPill status-${request.status}`}>{REQUEST_STATUS_LABELS[request.status]}</span><span>Qty {request.quantity}</span><span>{dateLabel(request.created_at)}</span></div>
                  </summary>
                  <div className="accountOrderBody">
                    <div className="accountInfoGrid">
                      <div><span>Needed by</span><strong>{dateLabel(request.deadline)}</strong></div>
                      <div><span>Fulfillment</span><strong>{request.delivery || "Not selected"}</strong></div>
                      <div><span>Quote</span><strong>{quote ? `${QUOTE_STATUS_LABELS[quote.status]} · ${money(quote.total_cents)}` : "Not ready yet"}</strong></div>
                      <div><span>Payment</span><strong>{quote ? `${paymentStatusLabel(request.payment_status)} · ${money(request.amount_paid_cents)} paid` : "Not due yet"}</strong></div>
                      <div><span>Proof version</span><strong>{quote ? `Version ${quote.proof_version}` : "—"}</strong></div>
                    </div>
                    <div className="accountOrderActions">
                      {quote && ["sent","changes_requested","approved"].includes(quote.status) ? <Link className="btn" href={`/quote/${quote.public_token}`}>{quote.status === "approved" && request.payment_status !== "paid" ? "Open payment" : "Review proof + quote"}</Link> : null}
                      <Link className="btn secondary" href={`/account/messages?order=${request.id}`}>Message Moore Made</Link>
                    </div>
                    {receipts.length ? <div className="accountReceipts"><strong>Payment receipts</strong><div>{receipts.map((receipt) => receipt.receipt_token ? <a key={receipt.id} href={`/receipt/${receipt.receipt_token}`} target="_blank" rel="noreferrer"><span>{receiptLabel(receipt.receipt_number)}</span><small>{paymentMethodLabel(receipt.payment_method)} · {money(receipt.amount_cents)}</small></a> : null)}</div></div> : null}
                    {files.length ? <div className="accountFiles"><strong>Your uploaded artwork</strong><div>{files.map((file) => <a key={file.url} href={file.url} target="_blank" rel="noreferrer">{file.name}</a>)}</div><small>Private links expire after 15 minutes.</small></div> : null}
                    {request.status === "shipped" && (request.tracking_url || request.tracking_number) ? <div className="accountFulfillment"><strong>Shipping</strong>{request.tracking_number ? <span>Tracking: {request.tracking_number}</span> : null}{request.tracking_url ? <a href={request.tracking_url} target="_blank" rel="noreferrer">Track shipment →</a> : null}</div> : null}
                    {request.status === "ready" && request.fulfillment_note ? <div className="accountFulfillment"><strong>Pickup note</strong><span>{request.fulfillment_note}</span></div> : null}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <section className="accountSection">
        <div className="accountSectionHead"><div><div className="eyebrow">Made by You</div><h2>Your showcase submissions</h2></div><Link className="btn secondary" href="/made-by-you/submit">Share an order</Link></div>
        {(showcaseData ?? []).length ? <div className="accountShowcaseList">{((showcaseData ?? []) as ShowcaseRow[]).map((post) => {
          const label = post.status === "approved" ? "Published" : post.status === "draft" ? (post.published_snapshot ? "Draft changes" : "Draft") : post.status === "rejected" ? (post.published_snapshot ? "Changes not published" : "Not published") : (post.published_snapshot ? "Changes awaiting approval" : "Awaiting approval");
          return <div className="card accountShowcaseRow" key={post.id}><div><strong>{post.product === "Untitled review" ? "Untitled review" : post.product}</strong><span>{"★".repeat(post.rating)}</span><small className="muted">Updated {dateLabel(post.updated_at)}</small></div><div className="accountShowcaseActions"><span className="badge">{label}</span><Link className="btn secondary" href={`/account/made-by-you/${post.id}`}>{post.status === "draft" ? "Continue editing" : "Edit review"}</Link></div></div>;
        })}</div> : <p className="muted">You have not submitted a Made by You post yet.</p>}
      </section>
    </div>
  );
}
