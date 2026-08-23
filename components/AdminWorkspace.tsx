"use client";

import { useMemo, useState } from "react";
import { QuoteBuilder } from "@/components/QuoteBuilder";
import { FulfillmentActions } from "@/components/FulfillmentActions";
import { ManualPaymentControl } from "@/components/ManualPaymentControl";
import { RequestStatusControl } from "@/components/RequestStatusControl";
import { ShowcaseStatusControl } from "@/components/ShowcaseStatusControl";
import { ShowcaseDeleteButton } from "@/components/ShowcaseDeleteButton";
import { ShowcasePhotoManager } from "@/components/ShowcasePhotoManager";
import { ShowcaseHomepageFeatureControl } from "@/components/ShowcaseHomepageFeatureControl";
import { ShowcaseCustomerPrimaryControl } from "@/components/ShowcaseCustomerPrimaryControl";
import { DeleteTestOrderButton } from "@/components/account/DeleteTestOrderButton";
import { AdminMessagesPanel } from "@/components/messages/AdminMessagesPanel";
import { AdminFinancialsPanel } from "@/components/admin/AdminFinancialsPanel";
import { MockupStudio } from "@/components/admin/MockupStudio";
import { AdminMockupTemplatesPanel } from "@/components/admin/AdminMockupTemplatesPanel";
import { AdminProductPricingPanel } from "@/components/admin/AdminProductPricingPanel";
import { AdminSupportGiftsPanel } from "@/components/admin/AdminSupportGiftsPanel";
import { PaymentShareLinkControl } from "@/components/PaymentShareLinkControl";
import { AdminCustomerMockupSummary } from "@/components/admin/AdminCustomerMockupSummary";
import { AdminCustomerIdeasPanel } from "@/components/admin/AdminCustomerIdeasPanel";
import { ProductionChecklist } from "@/components/admin/ProductionChecklist";
import { OrderNotificationControl } from "@/components/admin/OrderNotificationControl";
import { ArtworkRightsControl } from "@/components/admin/ArtworkRightsControl";
import { FinishedProductPhotosManager } from "@/components/admin/FinishedProductPhotosManager";
import { StripeTaxRecordingControl } from "@/components/admin/StripeTaxRecordingControl";
import type { AdminMessageThread, AdminUserOption } from "@/lib/message-types";
import type { BusinessExpenseRow, BusinessFinanceAuditRow, BusinessFundingRow, BusinessGoalRow, FinancialPaymentRow } from "@/lib/finance-types";
import type { DiscountCodeRecord } from "@/lib/discount-types";
import { compactSizeSummary, orderItemQuantity, type StructuredOrderItem, type ShippingAddress } from "@/lib/order-types";
import type { BusinessSettingsRecord, ProductPricingRecord } from "@/lib/pricing-types";
import {
  formatRequestNumber,
  REQUEST_STATUS_LABELS,
  type RequestStatus,
} from "@/lib/custom-request-types";
import { SHOWCASE_STATUS_LABELS, type ShowcaseStatus } from "@/lib/showcase-types";
import type { ShowcasePhotoPreview } from "@/lib/showcase-photo-preview";
import { money, type QuoteRecord } from "@/lib/quote-types";
import { customerIdeaLines } from "@/lib/customer-ideas";

type FileLink = { path: string; url: string };

function customerArtworkFileName(path: string, index: number) {
  const storedName = path.split("/").pop() || `artwork-${index + 1}`;
  return storedName.replace(/^\d+-\d+-/, "") || `artwork-${index + 1}`;
}

export type AdminRequestRow = {
  id: string;
  is_admin_test_order: boolean;
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
  requested_discount_code: string | null;
  order_items: StructuredOrderItem[];
  shipping_address: ShippingAddress | null;
  status: RequestStatus;
  payment_status: "unpaid" | "deposit_paid" | "paid";
  amount_paid_cents: number;
  artwork_paths: string[] | null;
  artwork_rights_accepted: boolean;
  artwork_rights_accepted_at: string | null;
  artwork_rights_policy_version: string | null;
  artwork_rights_review_status: string;
  artwork_rights_review_note: string | null;
  artwork_rights_reviewed_at: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  fulfillment_note: string | null;
  fulfillment_notified_at: string | null;
  estimated_fulfillment_date: string | null;
  estimated_fulfillment_note: string | null;
  estimated_fulfillment_notified_at: string | null;
  estimated_fulfillment_notified_for_date: string | null;
  review_request_sent_at: string | null;
  cash_payment_request_status: "none" | "pending" | "contacted" | "completed" | "cancelled";
  cash_payment_requested_at: string | null;
  cash_payment_requested_amount_cents: number | null;
  cash_payment_contacted_at: string | null;
  created_at: string;
  reorder_source_request_id: string | null;
  reorder_price_lock: Record<string, unknown> | null;
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
  homepage_featured: boolean;
  customer_primary: boolean;
  photo_paths: string[] | null;
  created_at: string;
  photoLinks: (FileLink & { preview: ShowcasePhotoPreview })[];
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
  funding: BusinessFundingRow[];
  goals: BusinessGoalRow[];
  financeAudit: BusinessFinanceAuditRow[];
  financialsReady: boolean;
  fundingReady: boolean;
  goalsReady: boolean;
  auditReady: boolean;
  discountCodes: DiscountCodeRecord[];
  discountsReady: boolean;
  productPricing: ProductPricingRecord[];
  businessSettings: BusinessSettingsRecord | null;
  pricingReady: boolean;
};

type OrderFilter = "all" | "review" | "production" | RequestStatus;
type ShowcaseFilter = "all" | ShowcaseStatus;

const orderFilters: { value: OrderFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "review", label: "Review / proof" },
  { value: "production", label: "Production" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function matchesOrderFilter(status: RequestStatus, filter: OrderFilter) {
  if (filter === "all") return true;
  if (filter === "review") return status === "reviewing" || status === "quote_sent";
  if (filter === "production") return ["approved", "in_production", "ready", "shipped"].includes(status);
  return status === filter;
}

function monthKeyInNewYork(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? String(value.getFullYear());
  const month = parts.find((part) => part.type === "month")?.value ?? String(value.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

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

export function AdminWorkspace({ requests, quotes, showcasePosts, messageThreads, adminUsers, currentAdminUserId, quoteReady, showcaseReady, messagesReady, payments, expenses, funding, goals, financeAudit, financialsReady, fundingReady, goalsReady, auditReady, discountCodes, discountsReady, productPricing, businessSettings, pricingReady }: Props) {
  const [tab, setTab] = useState<"orders" | "messages" | "financials" | "showcase" | "mockups" | "pricing" | "support">("orders");
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

  const paymentHistoryByRequest = useMemo(() => {
    const grouped = new Map<string, FinancialPaymentRow[]>();
    for (const payment of payments) {
      if (payment.status !== "paid" && payment.status !== "voided") continue;
      const current = grouped.get(payment.request_id) ?? [];
      current.push(payment);
      grouped.set(payment.request_id, current);
    }
    for (const rows of grouped.values()) {
      rows.sort((a, b) => new Date(b.paid_at || b.created_at).getTime() - new Date(a.paid_at || a.created_at).getTime());
    }
    return grouped;
  }, [payments]);

  const counts = useMemo(
    () => ({
      new: requests.filter((r) => r.status === "new").length,
      review: requests.filter((r) => ["reviewing", "quote_sent"].includes(r.status)).length,
      production: requests.filter((r) => ["approved", "in_production", "ready", "shipped"].includes(r.status)).length,
      completed: requests.filter((r) => r.status === "completed").length,
      messageUnread: messageThreads.reduce((sum, thread) => sum + thread.adminUnreadCount, 0),
      receivedThisMonth: payments
        .filter((payment) => payment.status === "paid" && monthKeyInNewYork(new Date(payment.paid_at || payment.created_at)) === monthKeyInNewYork())
        .reduce((sum, payment) => sum + Number(payment.amount_cents || 0), 0),
      showcasePending: showcasePosts.filter((r) => r.status === "pending").length,
    }),
    [requests, showcasePosts, messageThreads, payments]
  );

  const visibleRequests = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...requests]
      .filter((request) => matchesOrderFilter(request.status, orderFilter))
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

  function openOrderFromFinance(requestId: string) {
    setTab("orders");
    setOrderFilter("all");
    setQuery("");
    setOpenRequestId(requestId);
    window.setTimeout(() => document.getElementById(`order-${requestId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  return (
    <>
      <section className="adminStats adminStatsModern" aria-label="Dashboard overview">
        <button className="adminStat adminStatButton" type="button" onClick={() => jumpToOrders("new")}>
          <span>New requests</span><strong>{counts.new}</strong><small>Needs attention</small>
        </button>
        <button className="adminStat adminStatButton" type="button" onClick={() => jumpToOrders("review")}>
          <span>Review / proof</span><strong>{counts.review}</strong><small>Preparing approval</small>
        </button>
        <button className="adminStat adminStatButton" type="button" onClick={() => jumpToOrders("production")}>
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

      <nav className="adminWorkspaceSwitcher adminWorkspaceSwitcherFive" aria-label="Admin workspace area">
        <button type="button" className={["orders","messages","showcase"].includes(tab) ? "active" : ""} onClick={() => setTab("orders")}>
          <span className="adminWorkspaceSwitcherIcon">▣</span>
          <span><strong>Orders & customers</strong><small>Requests, messages, production, showcase</small></span>
        </button>
        <button type="button" className={tab === "mockups" ? "active" : ""} onClick={() => setTab("mockups")}>
          <span className="adminWorkspaceSwitcherIcon">✦</span>
          <span><strong>Mockup templates</strong><small>Move, resize, and save Shop defaults</small></span>
        </button>
        <button type="button" className={tab === "pricing" ? "active" : ""} onClick={() => setTab("pricing")}>
          <span className="adminWorkspaceSwitcherIcon">◇</span>
          <span><strong>Products & pricing</strong><small>Private costs, labor, margins, pickup tax address</small></span>
        </button>
        <button type="button" className={tab === "financials" ? "active" : ""} onClick={() => setTab("financials")}>
          <span className="adminWorkspaceSwitcherIcon">$</span>
          <span><strong>Business & financials</strong><small>Money, goals, records, tax readiness</small></span>
        </button>
        <button type="button" className={tab === "support" ? "active" : ""} onClick={() => setTab("support")}>
          <span className="adminWorkspaceSwitcherIcon">♥</span>
          <span><strong>Support gifts</strong><small>Private link, interest, gift letters</small></span>
        </button>
      </nav>

      {["orders","messages","showcase"].includes(tab) ? <div className="adminWorkspaceTabs adminOperationsTabs" role="tablist" aria-label="Orders and customers">
        <button type="button" className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>Orders <span>{requests.length}</span></button>
        <button type="button" className={tab === "messages" ? "active" : ""} onClick={() => setTab("messages")}>Messages <span>{counts.messageUnread}</span></button>
        <button type="button" className={tab === "showcase" ? "active" : ""} onClick={() => setTab("showcase")}>Made by You <span>{counts.showcasePending}</span></button>
      </div> : null}

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
                <span>{requests.filter((request) => matchesOrderFilter(request.status, filter.value)).length}</span>
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
              const requestPayments = paymentHistoryByRequest.get(request.id) ?? [];
              const latestReceipt = requestPayments.find((payment) => payment.status === "paid" && Boolean(payment.receipt_token)) ?? null;
              return (
                <article id={`order-${request.id}`} className={`adminRequestCompact ${isOpen ? "isOpen" : ""}`} key={request.id}>
                  <div className="adminRequestSummary">
                    <div className="adminRequestIdentity">
                      <div className="adminRequestKicker">
                        <span className="requestNumber">{formatRequestNumber(request.request_number)}</span>
                        <span className={`statusBadge status-${request.status}`}>{request.status === "ready" && String(request.delivery || "").toLowerCase().includes("delivery") ? "Ready for delivery" : REQUEST_STATUS_LABELS[request.status]}</span>
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
                      <RequestStatusControl id={request.id} initialStatus={request.status} delivery={request.delivery} initialReviewRequestSentAt={request.review_request_sent_at} />
                      <button className="btn adminViewButton" type="button" onClick={() => setOpenRequestId(isOpen ? null : request.id)} aria-expanded={isOpen}>
                        {isOpen ? "Close details" : "View details"}
                      </button>
                      {request.is_admin_test_order && request.status === "cancelled" ? <DeleteTestOrderButton requestId={request.id} requestNumber={formatRequestNumber(request.request_number)} /> : null}
                    </div>
                  </div>

                  <details className="adminOrderDocuments adminOrderDocumentsAlways" aria-label={`Documents for ${formatRequestNumber(request.request_number)}`}>
                    <summary className="adminOrderDocumentsHeading">
                      <div><span className="eyebrow">Documents</span><strong>Quote, invoice & receipt</strong></div>
                      <small>Open shortcuts</small>
                    </summary>
                    <div className="adminOrderDocumentButtons">
                      {quote?.public_token ? (
                        <a className="btn secondary" href={`/proforma/${quote.public_token}`} target="_blank" rel="noreferrer">Pro Forma + Proof ↗</a>
                      ) : (
                        <span className="btn secondary isDisabled" aria-disabled="true" title="Available after a proof + quote is created">Pro Forma + Proof</span>
                      )}
                      {quote?.public_token && quote.status === "approved" ? (
                        <a className="btn secondary" href={`/invoice/${quote.public_token}`} target="_blank" rel="noreferrer">Invoice ↗</a>
                      ) : (
                        <span className="btn secondary isDisabled" aria-disabled="true" title="Available after customer approval">Invoice · after approval</span>
                      )}
                      {latestReceipt?.receipt_token ? (
                        <a className="btn secondary" href={`/receipt/${latestReceipt.receipt_token}`} target="_blank" rel="noreferrer">Latest Receipt ↗</a>
                      ) : (
                        <span className="btn secondary isDisabled" aria-disabled="true" title="Receipt available after payment">Receipt · after payment</span>
                      )}
                    </div>
                  </details>

                  {isOpen ? (
                    <div className="adminRequestExpanded">
                      <AdminCustomerIdeasPanel requestId={request.id} artworkInstructions={request.artwork_instructions} customerNotes={request.notes} />
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
                            <div><dt>Fulfillment</dt><dd>{request.delivery || "Not specified"}</dd></div>
                            <div><dt>Needed by</dt><dd>{prettyDate(request.deadline)}</dd></div>
                            <div><dt>Payment</dt><dd>{request.payment_status === "paid" ? `Paid in full · ${money(request.amount_paid_cents)}` : request.payment_status === "deposit_paid" ? `Deposit paid · ${money(request.amount_paid_cents)} paid` : "Payment due"}</dd></div>
                          </dl>
                          {request.order_items?.length ? <div className="adminStructuredOrder">
                            <span className="eyebrow">Structured items</span>
                            {request.order_items.map((item) => <div className="adminStructuredOrderRow" key={item.id}>
                              <div><strong>{item.productName}</strong><small>{item.colorName || "Color not specified"}{item.designRelationship === "separate" ? " · Separate design" : item.designRelationship === "same" ? " · Same design direction" : ""}</small></div>
                              <div><strong>{orderItemQuantity(item)} pcs</strong><small>{compactSizeSummary(item) || "No size breakdown"}</small></div>
                            </div>)}
                          </div> : null}
                          {request.shipping_address ? <div className="adminShippingAddress"><span>{String(request.delivery || "").toLowerCase().includes("delivery") ? "Local delivery address" : "Shipping address"}</span><p>{request.shipping_address.name ? `${request.shipping_address.name} · ` : ""}{request.shipping_address.line1}{request.shipping_address.line2 ? `, ${request.shipping_address.line2}` : ""}<br />{request.shipping_address.city}, {request.shipping_address.state} {request.shipping_address.postalCode} · {request.shipping_address.country}</p></div> : null}
                        </section>

                        <section className="adminDetailGroup adminDetailGroupWide">
                          <div className="adminDetailGroupTitle"><span>03</span><h4>Customer mockup & production breakdown</h4></div>
                          <AdminCustomerMockupSummary requestId={request.id} />
                          {request.order_items?.length ? <ProductionChecklist requestNumber={formatRequestNumber(request.request_number)} customerName={request.customer_name} items={request.order_items} printSides={request.print_sides} /> : null}
                          <details className="adminTechnicalDetails">
                            <summary>Technical placement data</summary>
                            <div className="adminLongFields">
                              {request.sizes ? <div><span>Original size summary</span><pre className="adminScrollableText">{request.sizes}</pre></div> : null}
                              {request.placements?.length ? <div><span>Placement codes</span><p>{request.placements.map(prettyPlacement).join(" · ")}</p></div> : null}
                              {request.logo_size ? <div><span>Preview sizing</span><p className="adminScrollableText">{request.logo_size}</p></div> : null}
                              {request.artwork_instructions ? <div><span>Saved preview coordinates</span><p className="adminScrollableText">{request.artwork_instructions}</p></div> : null}
                            </div>
                          </details>
                        </section>

                      </div>

                      <div className="requestFiles adminFilesBlock">
                        <span>Artwork files</span>
                        {request.fileLinks.length ? (
                          <><div className="fileLinkRow">{request.fileLinks.map((file, index) => <a className="fileChip" href={file.url} target="_blank" rel="noreferrer" key={file.path} title={`Open the original customer upload: ${customerArtworkFileName(file.path, index)}`}>Download original · {customerArtworkFileName(file.path, index)} ↗</a>)}</div><p className="muted adminArtworkQualityNote">Check resolution, transparency, and print readiness. Do not promise that low-resolution art can simply be enhanced. Vector redraw/vectorization is preferred for logos. For detailed artwork, send a recreated proof for customer approval because cleanup can change lettering, shapes, faces, or colors. Add all artwork-preparation work to the quote.</p></>
                        ) : <p className="muted">No artwork uploaded.</p>}
                      </div>

                      <ArtworkRightsControl
                        requestId={request.id}
                        hasArtwork={request.fileLinks.length > 0}
                        accepted={request.artwork_rights_accepted}
                        acceptedAt={request.artwork_rights_accepted_at}
                        policyVersion={request.artwork_rights_policy_version}
                        initialStatus={request.artwork_rights_review_status}
                        initialNote={request.artwork_rights_review_note}
                      />

                      <section className="adminQuoteSection adminMockupSection">
                        <div className="adminDetailGroupTitle"><span>✦</span><h4>Mockup Studio</h4></div>
                        <MockupStudio requestId={request.id} requestNumber={formatRequestNumber(request.request_number)} product={request.product} />
                      </section>

                      <section className="adminQuoteSection">
                        <div className="adminDetailGroupTitle"><span>$</span><h4>Proof + quote approval</h4></div>
                        {quoteReady ? (
                          <QuoteBuilder requestId={request.id} requestNumber={formatRequestNumber(request.request_number)} product={request.product} quantity={request.quantity} orderItems={request.order_items} printSides={request.print_sides} customerIdeas={customerIdeaLines(request.artwork_instructions)} delivery={request.delivery} shippingAddress={request.shipping_address} existingQuote={quote} discountCodes={discountCodes} requestedDiscountCode={request.requested_discount_code} amountPaidCents={request.amount_paid_cents} pricingProfiles={productPricing} businessSettings={businessSettings} customerEmail={request.email} reorderPriceLock={request.reorder_price_lock} />
                        ) : <div className="requestWarning">Proof + quote data needs the latest database updates. If proofs were already working, run <code>supabase/moore_made_phase6_46_size_pricing_final_tax.sql</code>.</div>}
                      </section>

                      {quote ? (
                        <section className="adminQuoteSection adminPaymentSection">
                          <div className="adminDetailGroupTitle"><span>$</span><h4>Payment</h4></div>
                          <StripeTaxRecordingControl quote={quote} amountPaidCents={request.amount_paid_cents} />
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
                            policyAccepted={Boolean(quote.paymentPolicyAccepted)}
                            policyAcceptedAt={quote.paymentPolicyAcceptedAt || null}
                            payments={requestPayments}
                          />
                          <PaymentShareLinkControl requestId={request.id} quoteId={quote.id} requestNumber={formatRequestNumber(request.request_number)} quoteStatus={quote.status} amountDueCents={Math.max(0, quote.total_cents - request.amount_paid_cents)} policyAccepted={Boolean(quote.paymentPolicyAccepted)} customerEmail={request.email} />
                        </section>
                      ) : null}

                      <section className="adminQuoteSection adminFulfillmentSection">
                        <div className="adminDetailGroupTitle"><span>✓</span><h4>Fulfillment</h4></div>
                        <FulfillmentActions
                            id={request.id}
                            requestNumber={formatRequestNumber(request.request_number)}
                            initialStatus={request.status}
                            delivery={request.delivery}
                            shippingAddress={request.shipping_address}
                            initialTrackingNumber={request.tracking_number}
                            initialTrackingUrl={request.tracking_url}
                            initialNote={request.fulfillment_note}
                            initialEstimatedDate={request.estimated_fulfillment_date}
                            initialEstimatedNote={request.estimated_fulfillment_note}
                            initialEstimatedNotifiedAt={request.estimated_fulfillment_notified_at}
                            initialEstimatedNotifiedForDate={request.estimated_fulfillment_notified_for_date}
                            paymentStatus={request.payment_status}
                          />
                      </section>

                      <section className="adminQuoteSection adminFinishedPhotosSection">
                        <div className="adminDetailGroupTitle"><span>📸</span><h4>Finished product photos</h4></div>
                        <FinishedProductPhotosManager requestId={request.id} requestNumber={formatRequestNumber(request.request_number)} customerEmail={request.email} />
                      </section>

                      <section className="adminQuoteSection adminNotificationSection">
                        <div className="adminDetailGroupTitle"><span>✉</span><h4>Email notifications</h4></div>
                        <OrderNotificationControl requestId={request.id} requestNumber={formatRequestNumber(request.request_number)} customerEmail={request.email} orderStatus={request.status} paymentStatus={request.payment_status} delivery={request.delivery} />
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
      ) : tab === "support" ? (
        <AdminSupportGiftsPanel />
      ) : tab === "financials" ? (
        financialsReady ? <AdminFinancialsPanel orders={requests.map((request) => ({ id: request.id, request_number: request.request_number, customer_name: request.customer_name, product: request.product, amount_paid_cents: request.amount_paid_cents, payment_status: request.payment_status, status: request.status }))} quotes={quotes} payments={payments} expenses={expenses} funding={funding} goals={goals} financeAudit={financeAudit} adminUsers={adminUsers} fundingReady={fundingReady} goalsReady={goalsReady} auditReady={auditReady} discountCodes={discountCodes} discountsReady={discountsReady} businessSettings={businessSettings} onOpenOrder={openOrderFromFinance} /> : <section className="adminWorkspacePanel"><div className="formError">Financials need the latest database update. Run <code>supabase/moore_made_phase6_16_finance_command_center.sql</code> after your existing financial migrations.</div></section>
      ) : tab === "mockups" ? (
        <AdminMockupTemplatesPanel />
      ) : tab === "pricing" ? (
        <AdminProductPricingPanel records={productPricing} settings={businessSettings} ready={pricingReady} />
      ) : (
        <section className="adminWorkspacePanel">
          <div className="adminSectionIntro">
            <div><div className="eyebrow">Made by You</div><h2>Customer showcase approvals</h2><p>Review customer photos and reviews here. A customer&apos;s oldest approved review appears first by default. Use “Main customer review” to choose a different one, and “Feature homepage” to choose the single review highlighted on the homepage.</p></div>
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
                      {post.photoLinks[0] ? <img src={post.photoLinks[0].url} alt="Customer submitted project" style={{ objectPosition: `${post.photoLinks[0].preview.x}% ${post.photoLinks[0].preview.y}%`, transform: `scale(${post.photoLinks[0].preview.zoom})`, transformOrigin: `${post.photoLinks[0].preview.x}% ${post.photoLinks[0].preview.y}%` }} /> : <span>No photo</span>}
                    </div>
                    <div className="adminRequestIdentity">
                      <div className="adminRequestKicker"><span>{"★".repeat(post.rating)}{"☆".repeat(5 - post.rating)}</span><span className={`statusBadge showcase-${post.status}`}>{SHOWCASE_STATUS_LABELS[post.status]}</span></div>
                      <h3>{post.product}</h3>
                      <p>{post.business_name || post.customer_name}</p>
                      <p className="adminClamp">“{post.review}”</p>
                    </div>
                    <div className="adminRequestQuickActions">
                      <ShowcaseStatusControl id={post.id} initialStatus={post.status} />
                      <ShowcaseHomepageFeatureControl id={post.id} status={post.status} featured={post.homepage_featured} />
                      <ShowcaseCustomerPrimaryControl id={post.id} status={post.status} primary={post.customer_primary} />
                      <button className="btn secondary adminViewButton" type="button" onClick={() => setOpenShowcaseId(isOpen ? null : post.id)}>{isOpen ? "Close" : "Review post"}</button>
                      {isOpen ? <ShowcaseDeleteButton id={post.id} /> : null}
                    </div>
                  </div>

                  {isOpen ? <div className="adminRequestExpanded">
                    <ShowcasePhotoManager postId={post.id} initialPhotos={post.photoLinks} />
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
