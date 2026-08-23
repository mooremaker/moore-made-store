export type SupportPageSettings = {
  id: "default";
  enabled: boolean;
  access_token: string;
  expires_at: string | null;
  phone: string | null;
  contact_email: string | null;
  funding_goal_cents: number;
  headline: string;
  introduction: string;
  updated_at: string;
};

export type SupportInquiryStatus = "new" | "contacted" | "completed" | "declined";

export type SupportInquiry = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  preferred_contact: "phone" | "email" | "either";
  amount_range: string | null;
  message: string | null;
  help_requested: boolean;
  gift_terms_acknowledged: boolean;
  status: SupportInquiryStatus;
  admin_note: string | null;
  contacted_at: string | null;
  admin_email_sent_at: string | null;
  created_at: string;
};

export type SupportGift = {
  id: string;
  donor_name: string;
  donor_email: string;
  donor_message: string | null;
  acknowledgement_version: string;
  acknowledgement_text: string;
  acknowledged_at: string;
  status: "pending" | "link_sent" | "paid" | "failed" | "expired" | "refunded";
  gross_amount_cents: number | null;
  stripe_fee_cents: number | null;
  net_amount_cents: number | null;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
  created_at: string;
};

export const GIFT_ACKNOWLEDGEMENT_VERSION = "MM-GIFT-1.0";
export const GIFT_ACKNOWLEDGEMENT = "I understand this is a voluntary, non-repayable gift to Moore Made LLC. It provides no ownership, repayment, interest, profit sharing, goods or services, future discounts, or tax deduction.";

export const SUPPORT_INQUIRY_STATUS_LABELS: Record<SupportInquiryStatus, string> = {
  new: "New",
  contacted: "Contacted",
  completed: "Gift completed",
  declined: "Not moving forward",
};
