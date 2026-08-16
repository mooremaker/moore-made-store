"use client";

import { useMemo, useState } from "react";
import { QuoteBuilder } from "@/components/QuoteBuilder";
import { FulfillmentActions } from "@/components/FulfillmentActions";
import { ManualPaymentControl } from "@/components/ManualPaymentControl";
import { CashPaymentAdminAlert } from "@/components/CashPaymentAdminAlert";
import { RequestStatusControl } from "@/components/RequestStatusControl";
import { ShowcaseStatusControl } from "@/components/ShowcaseStatusControl";
import { ShowcaseDeleteButton } from "@/components/ShowcaseDeleteButton";
import { AdminMessagesPanel } from "@/components/messages/AdminMessagesPanel";
import { AdminFinancialsPanel } from "@/components/admin/AdminFinancialsPanel";
import type { AdminMessageThread, AdminUserOption } from "@/lib/message-types";
import type { BusinessExpenseRow, FinancialPaymentRow } from "@/lib/finance-types";
import {
  formatRequestNumber,
  REQUEST_STATUS_LABELS,
  type RequestStatus,
} from "@/lib/custom-request-types";
import { SHOWCASE_STATUS_LABELS, type ShowcaseStatus } from "@/lib/showcase-types";
import { money, type QuoteRecord } from "@/lib/quote-types";

type FileLink = { path: string; url: string };

export type AdminRequestRow = {
  id: string;
  request_number: number;
  customer_name: string;
  email: string;
  phone: string | null;
  sms_consent: boolean;
  product: string;
  quantity: number;
  item_type: string | null;
  colors: string | null;
  sizes: string | null;
  logo_size: string | null;
  print_sides: string | null;
  placements: string[] | null;
  artwork_instructions: string | null;
  deadline: string | null;
  delivery: string | null;
  notes: string | null;
  status: RequestStatus;
  payment_status: "unpaid" | "deposit_paid" | "paid";
  amount_paid_cents: number;
  artwork_paths: string[] | null;
  tracking_number: string | null;
  tracking_url: string | null;
  fulfillment_note: string | null;
  fulfillment_notified_at: string | null;
  cash_payment_request_status: "none" | "pending" | "contacted" | "completed" | "cancelled";
  cash_payment_requested_at: string | null;
  cash_payment_requested_amount_cents: number | null;
  cash_payment_contacted_at: string | null;
  created_at: string;
  fileLinks: FileLink[];
};

export type AdminShowcaseRow = {
  id: string;
  customer_name: string;
  business_name: string | null;
  email: string;
  product: string;
  rating: number;
  review: string;
  caption: string | null;
  social_handle: string | null;
  status: ShowcaseStatus;
  photo_paths: string[] | null;
  created_at: string;
  photoLinks: FileLink[];
};

type Props = {
  requests: AdminRequestRow[];
  quotes: QuoteRecord[];
  showcasePosts: AdminShowcaseRow[];
  messageThreads: AdminMessageThread[];
  adminUsers: AdminUserOption[];
  currentAdminUserId: string;
  quoteReady: boolean;
  showcaseReady: boolean;
  messagesReady: boolean;
  payments: FinancialPaymentRow[];
  expenses: BusinessExpenseRow[];
  financialsReady: boolean;
};

type OrderFilter = "all" | RequestStatus;
type ShowcaseFilter = "all" | ShowcaseStatus;

const orderFilters: { value: OrderFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "reviewing", label: "Reviewing" },
  { value: "quote_sent", label: "Proof + quote sent" },
  { value: "approved", label: "Approved" },
  { value: "in_production", label: "In production" },
  { value: "ready", label: "Ready for pickup" },
  { value: "shipped", label: "Shipped" },
  { value: "completed", label: "Completed" },
];

const prettyPlacement = (value: string) =>
  value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

function prettyDate(value: string | null) {
  if (!value) return "No date";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${Number(month)}/${Number(day)}/${year}`;
}

function submittedDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  });
}

export function AdminWorkspace({ requests, quotes, showcasePosts, messageThreads, adminUsers, currentAdminUserId, quoteReady, showcaseReady, messagesReady, payments, expenses, financialsReady }: Props) {
  const [tab, setTab] = useState<"orders" | "messages" | "financials" | "showcase">("orders");
  const [query, setQuery] = useState("");
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [openRequestId, setOpenRequestId] = useState<string | null>(null);
  const [showcaseFilter, setShowcaseFilter] = useState<ShowcaseFilter>("pending");
  const [openShowcaseId, setOpenShowcaseId] = useState<string | null>(null);

  const quoteByRequest = useMemo(
    () => new Map(quotes.map((quote) => [quote.request_id, quote])),
    [quotes]
  );

  const counts = useMemo(
    () => ({
      new: requests.filter((r) => r.status === "new").length,
      review: requests.filter((r) => ["reviewing", "quote_sent"].includes(r.status)).length,
      production: requests.filter((r) => ["approved", "in_production", "ready", "shipped"].includes(r.status)).length,
      completed: requests.filter((r) => r.status === "completed").length,
      messageUnread: messageThreads.reduce((sum, thread) => sum + thread.adminUnreadCount, 0),
      receivedThisMonth: payments.filter((payment) => payment.status === "paid" && (payment.paid_at || payment.created_at).slice(0, 7) === new Date().toISOString().slice(0, 7)).reduce((sum, payment) => sum + Number(payment.amount_cents || 0), 0),
      showcasePending: showcasePosts.filter((r) => r.status === "pending").length,
    }),
    [requests, showcasePosts, messageThreads, payments]
  );

  const visibleRequests = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...requests]
      .filter((request) => orderFilter === "all" || request.status === orderFilter)
      .filter((request) => {
        if (!normalized) return true;
        const haystack = [
          formatRequestNumber(request.request_number),
          request.customer_name,
          request.email,
          request.phone ?? "",
          request.product,
          request.item_type ?? "",
          request.colors ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalized);
      })
      .sort((a, b) => {
        const delta = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        return sort === "newest" ? delta : -delta;
      });
  }, [requests, orderFilter, query, sort]);

  const visibleShowcase = useMemo(
    () => showcasePosts.filter((post) => showcaseFilter === "all" || post.status === showcaseFilter),
    [showcasePosts, showcaseFilter]
  );

  function jumpToOrders(filter: OrderFilter) {
    setTab("orders");
    setOrderFilter(filter);
  }

  return (
    <>
      <section className="adminStats adminStatsModern" aria-label="Dashboard overview">
        <button className="adminStat adminStatButton" type="button" onClick={() => jumpToOrders("new")}>
          <span>New requests</span><strong>{counts.new}</strong><small>Needs attention</small>
        </button>
        <button className="adminStat adminStatButton" type="button" onClick={() => jumpToOrders("reviewing")}>
          <span>Review / proof</span><strong>{counts.review}</strong><small>Preparing approval</small>
        </button>
        <button className="adminStat adminStatButton" type="button" onClick={() => jumpToOrders("approved")}>
          <span>Production</span><strong>{counts.production}</strong><small>Approved to ready</small>
        </button>
        <button className="adminStat adminStatButton" type="button" onClick={() => jumpToOrders("completed")}>
          <span>Completed</span><strong>{counts.completed}</strong><small>Finished orders</small>
        </button>
        <button className="adminStat adminStatButton adminStatMessages" type="button" onClick={() => setTab("messages")}>
          <span>Messages</span><strong>{counts.messageUnread}</strong><small>Unread customer replies</small>
        </button>
        <button className="adminStat adminStatButton adminStatFinancials" type="button" onClick={() => setTab("financials")}>
          <span>Financials</span><strong>{money(counts.receivedThisMonth)}</strong><small>Received this month</small>
        </button>
        <button className="adminStat adminStatButton adminStatShowcase" type="button" onClick={() => { setTab("showcase"); setShowcaseFilter("pending"); }}>
          <span>Made by You</span><strong>{counts.showcasePending}</strong><small>Awaiting approval</small>
        </button>
      </section>

      <div className="adminWorkspaceTabs" role="tablist" aria-label="Admin workspace">
        <button type="button" className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>Orders <span>{requests.length}</span></button>
        <button type="button" className={tab === "messages" ? "active" : ""} onClick={() => setTab("messages")}>Messages <span>{counts.messageUnread}</span></button>
        <button type="button" className={tab === "financials" ? "active" : ""} onClick={() => setTab("financials")}>Financials</button>
        <button type="button" className={tab === "showcase" ? "active" : ""} onClick={() => setTab("showcase")}>Made by You <span>{counts.showcasePending}</span></button>
      </div>

      {tab === "orders" ? (
        <section className="adminWorkspacePanel">
          <div className="adminSectionIntro">
            <div><div className="eyebrow">Orders</div><h2>Custom request inbox</h2><p>Scan the essentials first. Open a request when you need the full details, proof + quote tools, or final fulfillment notification.</p></div>
          </div>

          <div className="adminInboxToolbar">
            <label className="adminSearch">
              <span className="srOnly">Search orders</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customer, MM number, email, product…" />
            </label>
            <label className="adminSort">
              <span>Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as "newest" | "oldest")}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
          </div>

          <div className="adminFilterRow" aria-label="Filter orders by status">
            {orderFilters.map((filter) => (
              <button key={filter.value} type="button" className={orderFilter === filter.value ? "active" : ""} onClick={() => setOrderFilter(filter.value)}>
                {filter.label}
                <span>{filter.value === "all" ? requests.length : requests.filter((r) => r.status === filter.value).length}</span>
              </button>
            ))}
          </div>

          <div className="adminResultsMeta">Showing <strong>{visibleRequests.length}</strong> of {requests.length} requests</div>

          <div className="requestInbox requestInboxModern">
            {visibleRequests.length === 0 ? (
              <div className="empty adminEmptyState"><h2>No matching requests.</h2><p className="muted">Try another search or status filter.</p></div>
            ) : visibleRequests.map((request) => {
              const isOpen = openRequestId === request.id;
              const quote = quoteByRequest.get(request.id) ?? null;
              return (
                <article id={`order-${request.id}`} className={`adminRequestCompact ${isOpen ? "isOpen" : ""}`} key={request.id}>
                  <div className="adminRequestSummary">
                    <div className="adminRequestIdentity">
                      <div className="adminRequestKicker">
                        <span className="requestNumber">{formatRequestNumber(request.request_number)}</span>
                        <span className={`statusBadge status-${request.status}`}>{REQUEST_STATUS_LABELS[request.status]}</span>
                        {request.cash_payment_request_status === "pending" ? <span className="statusBadge cashRequestSummaryBadge">Cash requested</span> : null}
                      </div>
                      <h3>{request.customer_name}</h3>
                      <p>{request.product}{request.item_type ? ` · ${request.item_type}` : ""}</p>
                    </div>

                    <div className="adminRequestSummaryFacts">
                      <div><span>Qty</span><strong>{request.quantity}</strong></div>
                      <div><span>Needed by</span><strong>{prettyDate(request.deadline)}</strong></div>
                      <div><span>Submitted</span><strong>{new Date(request.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong></div>
                      <div><span>Payment</span><strong>{request.payment_status === "paid" ? "Paid" : request.payment_status === "deposit_paid" ? "Deposit paid" : "Due"}</strong></div>
                    </div>

                    <div className="adminRequestQuickActions">
                      <RequestStatusControl id={request.id} initialStatus={request.status} />
                      <button className="btn adminViewButton" type="button" onClick={() => setOpenRequestId(isOpen ? null : request.id)} aria-expanded={isOpen}>
                        {isOpen ? "Close details" : "View details"}
                      </button>
                    </div>
                  </div>

                  {isOpen ? (
                    <div className="adminRequestExpanded">
                      <div className="adminDetailGrid">
                        <section className="adminDetailGroup">
                          <div className="adminDetailGroupTitle"><span>01</span><h4>Contact</h4></div>
                          <dl className="adminDefinitionList">
                            <div><dt>Email</dt><dd><a href={`mailto:${request.email}`}>{request.email}</a></dd></div>
                            <div><dt>Phone</dt><dd>{request.phone ? <a href={`tel:${request.phone}`}>{request.phone}</a> : "Not provided"}</dd></div>
                            <div><dt>Text permission</dt><dd>{request.phone ? (request.sms_consent ? <span className="smsAdminFlag smsYes">Texts OK</span> : <span className="smsAdminFlag smsNo">No text consent</span>) : "—"}</dd></div>
                          </dl>
                        </section>

                        <section className="adminDetailGroup">
                          <div className="adminDetailGroupTitle"><span>02</span><h4>Order</h4></div>
                          <dl className="adminDefinitionList">
                            <div><dt>Product</dt><dd>{request.product}</dd></div>
                            <div><dt>Quantity</dt><dd>{request.quantity}</dd></div>
                            <div><dt>Style</dt><dd className="adminWrapValue">{request.item_type || "Not specified"}</dd></div>
                            <div><dt>Colors</dt><dd className="adminWrapValue">{request.colors || "Not specified"}</dd></div>
                            <div><dt>Front / back</dt><dd>{request.print_sides || "Not specified"}</dd></div>
                            <div><dt>Delivery</dt><dd>{request.delivery || "Not specified"}</dd></div>
                            <div><dt>Needed by</dt><dd>{prettyDate(request.deadline)}</dd></div>
                            <div><dt>Payment</dt><dd>{request.payment_status === "paid" ? `Paid in full · ${money(request.amount_paid_cents)}` : request.payment_status === "deposit_paid" ? `Deposit paid · ${money(request.amount_paid_cents)} paid` : "Payment due"}</dd></div>
                          </dl>
                        </section>

                        <section className="adminDetailGroup adminDetailGroupWide">
                          <div className="adminDetailGroupTitle"><span>03</span><h4>Artwork & sizing</h4></div>
                          <div className="adminLongFields">
                            {request.sizes ? <div><span>Sizes / quantities</span><pre className="adminScrollableText">{request.sizes}</pre></div> : null}
                            {request.placements?.length ? <div><span>Placement</span><p>{request.placements.map(prettyPlacement).join(" · ")}</p></div> : null}
                            {request.logo_size ? <div><span>Design size</span><p className="adminScrollableText">{request.logo_size}</p></div> : null}
                            {request.artwork_instructions ? <div><span>Artwork instructions</span><p className="adminScrollableText">{request.artwork_instructions}</p></div> : null}
                          </div>
                        </section>

                        {request.notes ? (
                          <section className="adminDetailGroup adminDetailGroupWide">
                            <div className="adminDetailGroupTitle"><span>04</span><h4>Customer notes</h4></div>
                            <p className="adminScrollableText adminNoteText">{request.notes}</p>
                          </section>
                        ) : null}
                      </div>

                      <div className="requestFiles adminFilesBlock">
                        <span>Artwork files</span>
                        {request.fileLinks.length ? (
                          <div className="fileLinkRow">{request.fileLinks.map((file, index) => <a className="fileChip" href={file.url} target="_blank" rel="noreferrer" key={file.path}>Open file {index + 1} ↗</a>)}</div>
                        ) : <p className="muted">No artwork uploaded.</p>}
                      </div>

                      <section className="adminQuoteSection">
                        <div className="adminDetailGroupTitle"><span>$</span><h4>Proof + quote approval</h4></div>
                        {quoteReady ? (
                          <QuoteBuilder requestId={request.id} requestNumber={formatRequestNumber(request.request_number)} product={request.product} quantity={request.quantity} existingQuote={quote} />
                        ) : <div className="requestWarning">Proof + quote approval is not set up yet. Run the Phase 2D scalable proofs SQL migration.</div>}
                      </section>

                      {request.cash_payment_request_status === "pending" || request.cash_payment_request_status === "contacted" ? (
                        <section className="adminQuoteSection adminCashRequestSection">
                          <div className="adminDetailGroupTitle"><span>$</span><h4>Cash payment arrangement</h4></div>
                          <CashPaymentAdminAlert
                            requestId={request.id}
                            requestNumber={formatRequestNumber(request.request_number)}
                            customerName={request.customer_name}
                            email={request.email}
                            phone={request.phone}
                            smsConsent={request.sms_consent}
                            amountCents={request.cash_payment_requested_amount_cents}
                            initialStatus={request.cash_payment_request_status}
                            requestedAt={request.cash_payment_requested_at}
                          />
                        </section>
                      ) : null}

                      {quote ? (
                        <section className="adminQuoteSection adminPaymentSection">
                          <div className="adminDetailGroupTitle"><span>$</span><h4>Payment</h4></div>
                          <ManualPaymentControl
                            requestId={request.id}
                            quoteId={quote.id}
                            requestNumber={formatRequestNumber(request.request_number)}
                            quoteStatus={quote.status}
                            totalCents={quote.total_cents}
                            paymentTerms={quote.payment_terms}
                            depositAmountCents={quote.deposit_amount_cents}
                            amountPaidCents={request.amount_paid_cents}
                            paymentStatus={request.payment_status}
                          />
                        </section>
                      ) : null}

                      <section className="adminQuoteSection adminFulfillmentSection">
                        <div className="adminDetailGroupTitle"><span>✓</span><h4>Fulfillment</h4></div>
                        {["approved", "in_production", "ready", "shipped", "completed"].includes(request.status) ? (
                          <FulfillmentActions
                            id={request.id}
                            requestNumber={formatRequestNumber(request.request_number)}
                            initialStatus={request.status}
                            delivery={request.delivery}
                            initialTrackingNumber={request.tracking_number}
                            initialTrackingUrl={request.tracking_url}
                            initialNote={request.fulfillment_note}
                            paymentStatus={request.payment_status}
                          />
                        ) : <p className="muted adminFulfillmentLocked">Final customer notification becomes available after the proof + quote is approved.</p>}
                      </section>

                      <div className="requestCreated">Submitted {submittedDate(request.created_at)}</div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : tab === "messages" ? (
        messagesReady ? <AdminMessagesPanel threads={messageThreads} adminUsers={adminUsers} currentAdminUserId={currentAdminUserId} /> : <section className="adminWorkspacePanel"><div className="formError">Messages are not set up in Supabase yet. Run supabase/moore_made_phase5_messages.sql.</div></section>
      ) : tab === "financials" ? (
        financialsReady ? <AdminFinancialsPanel orders={requests.map((request) => ({ id: request.id, request_number: request.request_number, customer_name: request.customer_name, product: request.product, amount_paid_cents: request.amount_paid_cents, payment_status: request.payment_status, status: request.status }))} quotes={quotes} payments={payments} expenses={expenses} /> : <section className="adminWorkspacePanel"><div className="formError">Financials need a database update. Run supabase/moore_made_phase6_1_expense_receipts.sql (and Phase 6 first if you have not already).</div></section>
      ) : (
        <section className="adminWorkspacePanel">
          <div className="adminSectionIntro">
            <div><div className="eyebrow">Made by You</div><h2>Customer showcase approvals</h2><p>Review customer photos and reviews here. Nothing appears publicly until you approve it.</p></div>
          </div>

          {!showcaseReady ? <div className="formError">Made by You is not set up in Supabase yet. Run supabase/moore_made_phase2_1_made_by_you.sql.</div> : null}

          <div className="adminFilterRow adminShowcaseFilters">
            {(["pending", "approved", "rejected", "all"] as ShowcaseFilter[]).map((value) => (
              <button type="button" key={value} className={showcaseFilter === value ? "active" : ""} onClick={() => setShowcaseFilter(value)}>
                {value === "all" ? "All" : SHOWCASE_STATUS_LABELS[value]}
                <span>{value === "all" ? showcasePosts.length : showcasePosts.filter((post) => post.status === value).length}</span>
              </button>
            ))}
          </div>

          <div className="adminShowcaseInbox">
            {visibleShowcase.length === 0 && showcaseReady ? <div className="empty adminEmptyState"><h2>No posts in this view.</h2><p className="muted">New customer submissions will appear here.</p></div> : visibleShowcase.map((post) => {
              const isOpen = openShowcaseId === post.id;
              return (
                <article className={`adminShowcaseCompact ${isOpen ? "isOpen" : ""}`} key={post.id}>
                  <div className="adminShowcaseSummary">
                    <div className="adminShowcaseThumb">
                      {post.photoLinks[0] ? <img src={post.photoLinks[0].url} alt="Customer submitted project" /> : <span>No photo</span>}
                    </div>
                    <div className="adminRequestIdentity">
                      <div className="adminRequestKicker"><span>{"★".repeat(post.rating)}{"☆".repeat(5 - post.rating)}</span><span className={`statusBadge showcase-${post.status}`}>{SHOWCASE_STATUS_LABELS[post.status]}</span></div>
                      <h3>{post.product}</h3>
                      <p>{post.business_name || post.customer_name}</p>
                      <p className="adminClamp">“{post.review}”</p>
                    </div>
                    <div className="adminRequestQuickActions">
                      <ShowcaseStatusControl id={post.id} initialStatus={post.status} />
                      <button className="btn secondary adminViewButton" type="button" onClick={() => setOpenShowcaseId(isOpen ? null : post.id)}>{isOpen ? "Close" : "Review post"}</button>
                      {isOpen ? <ShowcaseDeleteButton id={post.id} /> : null}
                    </div>
                  </div>

                  {isOpen ? <div className="adminRequestExpanded">
                    <div className="adminShowcasePhotos">{post.photoLinks.map((photo) => <a key={photo.path} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt="Customer submitted project" /></a>)}</div>
                    <div className="adminDetailGrid">
                      <section className="adminDetailGroup"><div className="adminDetailGroupTitle"><span>01</span><h4>Customer</h4></div><dl className="adminDefinitionList"><div><dt>Name</dt><dd>{post.customer_name}</dd></div><div><dt>Business</dt><dd>{post.business_name || "—"}</dd></div><div><dt>Email</dt><dd><a href={`mailto:${post.email}`}>{post.email}</a></dd></div><div><dt>Social</dt><dd>{post.social_handle || "—"}</dd></div></dl></section>
                      <section className="adminDetailGroup"><div className="adminDetailGroupTitle"><span>02</span><h4>Review</h4></div><p className="adminScrollableText">“{post.review}”</p>{post.caption ? <><div className="adminMiniLabel">Caption</div><p className="adminScrollableText">{post.caption}</p></> : null}</section>
                    </div>
                  </div> : null}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
