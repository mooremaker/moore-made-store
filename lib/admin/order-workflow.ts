import type { RequestStatus } from "@/lib/custom-request-types";
import type { QuoteStatus } from "@/lib/quote-types";

export type OrderSection = "overview" | "design" | "quote" | "production" | "history";
export const ORDER_SECTIONS: { value: OrderSection; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "design", label: "Design & proofs" },
  { value: "quote", label: "Quote & payment" },
  { value: "production", label: "Production & delivery" },
  { value: "history", label: "Messages & history" },
];

type Order = { status: RequestStatus; payment_status: "unpaid" | "deposit_paid" | "paid"; deadline: string | null; delivery: string | null };
type Quote = { status: QuoteStatus; valid_until?: string | null } | null;
export function nextOrderAction(order: Order, quote: Quote) {
  if (order.status === "cancelled") return { label: "Review cancelled order", section: "history" as const, note: "This order is cancelled.", waiting: false };
  if (order.status === "completed") return { label: "View order history", section: "history" as const, note: "This order is complete.", waiting: false };
  if (quote?.status === "changes_requested" || quote?.status === "declined" || quote?.status === "expired") return { label: "Review quote", section: "quote" as const, note: quote.status === "changes_requested" ? "The customer requested changes." : quote.status === "expired" ? "Review the expired quote before resending." : "The customer declined this quote.", waiting: false };
  if (order.status === "shipped") return { label: "Review shipment", section: "production" as const, note: "Check tracking and confirm completion.", waiting: false };
  if (order.status === "ready") return { label: "Arrange fulfillment", section: "production" as const, note: "Arrange pickup, delivery or shipping.", waiting: false };
  if (order.status === "in_production") return { label: "Continue production", section: "production" as const, note: "Check the items, finish the order and arrange fulfillment.", waiting: false };
  if (order.status === "approved" || quote?.status === "approved") {
    if (order.payment_status === "unpaid") return { label: "Review payment", section: "quote" as const, note: "Approved; payment is still outstanding.", waiting: true };
    return { label: "Prepare production", section: "production" as const, note: order.payment_status === "deposit_paid" ? "Deposit received. Review the payment terms before production." : "Paid. Check the materials and start production.", waiting: false };
  }
  if (quote?.status === "sent" || order.status === "quote_sent") return { label: "Review sent quote", section: "quote" as const, note: "Waiting for the customer to approve the quote.", waiting: true };
  if (quote?.status === "draft") return { label: "Finish quote", section: "quote" as const, note: "Review the pricing and proof, then preview and send.", waiting: false };
  if (order.status === "new") return { label: "Review request", section: "overview" as const, note: "Confirm the products, sizes, artwork and deadline.", waiting: false };
  return { label: "Prepare proof", section: "design" as const, note: "Review the artwork and prepare the customer proof.", waiting: false };
}

export function easternToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function isOrderOverdue(order: Order, today: string) {
  return Boolean(order.deadline && order.deadline < today && !["completed", "cancelled", "shipped"].includes(order.status));
}

// Reflect an authoritative customer approval without moving fulfilled orders backwards.
export function effectiveOrderStatus(status: RequestStatus, quote: Quote): RequestStatus {
  if (["new", "reviewing", "quote_sent", "awaiting_payment"].includes(status) && quote?.status === "approved") return "approved";
  return status;
}
