export const REQUEST_STATUSES = [
  "new",
  "reviewing",
  "quote_sent",
  "approved",
  "in_production",
  "ready",
  "shipped",
  "completed",
  "cancelled",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  quote_sent: "Proof + quote sent",
  approved: "Approved",
  in_production: "In production",
  ready: "Ready for pickup",
  shipped: "Shipped",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function formatRequestNumber(value: number | string) {
  return `MM-${String(value).padStart(6, "0")}`;
}
