import { notFound } from "next/navigation";
import { AdminWorkspace, type AdminRequestRow } from "@/components/AdminWorkspace";
import type { QuoteRecord } from "@/lib/quote-types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Moore Made | Sample Admin Workspace", robots: { index: false, follow: false } };

function sampleOrder(overrides: Partial<AdminRequestRow>): AdminRequestRow {
  return {
    id: "sample-request-1", is_admin_test_order: false, request_number: 284563,
    customer_name: "Taylor · SAMPLE", email: "taylor@example.test", phone: null, sms_consent: false,
    product: "T-shirts", quantity: 17, item_type: "T-shirts", colors: "Black",
    sizes: "18 months × 1, M × 1, L × 9, XL × 3, 2XL × 2, 3XL Tall × 1", logo_size: null,
    print_sides: "Front", placements: ["front"], artwork_instructions: "2026 FAMILY / CRUISE CREW. Full-front sunset colors.",
    deadline: "2026-10-09", delivery: "Local pickup", notes: "Sample order for preview only.", requested_discount_code: null,
    order_items: [], shipping_address: null, status: "quote_sent", payment_status: "unpaid", amount_paid_cents: 0,
    artwork_paths: [], artwork_rights_accepted: false, artwork_rights_accepted_at: null, artwork_rights_policy_version: null,
    artwork_rights_review_status: "pending", artwork_rights_review_note: null, artwork_rights_reviewed_at: null,
    tracking_number: null, tracking_url: null, fulfillment_note: null, fulfillment_notified_at: null,
    estimated_fulfillment_date: null, estimated_fulfillment_note: null, estimated_fulfillment_notified_at: null,
    estimated_fulfillment_notified_for_date: null, review_request_sent_at: null, cash_payment_request_status: "none",
    cash_payment_requested_at: null, cash_payment_requested_amount_cents: null, cash_payment_contacted_at: null,
    created_at: "2026-10-01T16:00:00Z", reorder_source_request_id: null, reorder_price_lock: null, fileLinks: [],
    ...overrides,
  };
}

export default function SampleAdminPage() {
  if (process.env.MOORE_MADE_PREVIEW !== "1" || process.env.NODE_ENV === "production") notFound();
  const requests = [sampleOrder({}), sampleOrder({id:"sample-request-2",request_number:284564,customer_name:"Morgan · SAMPLE",product:"Tote bags",quantity:12,status:"new",deadline:"2026-10-12",sizes:null,colors:"Natural"}), sampleOrder({id:"sample-request-3",request_number:284560,customer_name:"Alex · SAMPLE",quantity:8,status:"in_production",payment_status:"paid",amount_paid_cents:16000,deadline:"2026-10-07"})];
  const quote: QuoteRecord = {id:"sample-quote",request_id:"sample-request-1",public_token:"sample-not-a-live-token",status:"sent",line_items:[{description:"Black T-shirt · full-front design",quantity:17,unitPriceCents:2500}],setup_fee_cents:0,shipping_cents:0,tax_cents:2348,discount_cents:6375,subtotal_cents:42500,total_cents:38473,payment_terms:"full",deposit_amount_cents:null,notes:"Local pickup",valid_until:"2026-10-05",proof_version:1,customer_change_request:null,sent_at:"2026-10-01T16:00:00Z",responded_at:null,created_at:"2026-10-01T16:00:00Z",updated_at:"2026-10-01T16:00:00Z"};
  return <div className="shell adminPage adminPageRedesign"><section className="adminTopbar adminTopbarRedesign"><div><div className="eyebrow">Moore Made · sample data</div><h1>Admin</h1></div><span className="muted">Layout preview · no live actions</span></section><AdminWorkspace requests={requests} quotes={[quote]} showcasePosts={[]} messageThreads={[]} adminUsers={[]} currentAdminUserId="sample-admin" quoteReady showcaseReady messagesReady payments={[]} expenses={[]} funding={[]} goals={[]} financeAudit={[]} financialsReady fundingReady goalsReady auditReady discountCodes={[]} discountsReady productPricing={[]} businessSettings={null} pricingReady /></div>;
}
