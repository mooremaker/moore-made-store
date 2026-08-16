export type MessageTopic = "order" | "product" | "artwork" | "payment" | "shipping" | "other";
export type MessageThreadStatus = "open" | "resolved" | "archived";
export type MessageSenderRole = "customer" | "admin" | "system";

export const MESSAGE_TOPIC_LABELS: Record<MessageTopic, string> = {
  order: "Order question",
  product: "Product question",
  artwork: "Artwork / design help",
  payment: "Payment",
  shipping: "Shipping / pickup",
  other: "Other",
};

export const MESSAGE_STATUS_LABELS: Record<MessageThreadStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  archived: "Archived",
};

export type MessageAttachment = {
  id: string;
  path: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  url?: string;
};

export type MessageEntry = {
  id: string;
  threadId: string;
  senderUserId: string | null;
  senderRole: MessageSenderRole;
  senderDisplayName: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  attachments: MessageAttachment[];
};

export type CustomerMessageThread = {
  id: string;
  requestId: string | null;
  requestNumber: number | null;
  requestProduct: string | null;
  subject: string;
  topic: MessageTopic;
  status: MessageThreadStatus;
  customerUnreadCount: number;
  lastMessageAt: string;
  createdAt: string;
  entries: MessageEntry[];
};

export type AdminMessageThread = CustomerMessageThread & {
  customerUserId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  smsConsent: boolean;
  adminUnreadCount: number;
  assignedAdminUserId: string | null;
};

export type AdminUserOption = {
  id: string;
  name: string;
  email: string;
};
