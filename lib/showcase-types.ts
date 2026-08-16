export type ShowcaseStatus = "pending" | "approved" | "rejected";

export const SHOWCASE_STATUS_LABELS: Record<ShowcaseStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};
