export const FINAL_SALE_POLICY_VERSION = "MM-CUSTOM-ORDER-1.0";
export const FINAL_SALE_POLICY_TITLE = "Moore Made Custom Order & Final Sale Policy";

export const FINAL_SALE_POLICY_SUMMARY =
  "Every Moore Made order is custom designed and made specifically for the customer. All sales are final. Deposits and payments are non-refundable, and custom products are not eligible for return or exchange.";

export const FINAL_SALE_POLICY_ACKNOWLEDGMENTS = [
  {
    key: "finalSale",
    label:
      "I understand that this is a custom-made order. All sales are final, all deposits and payments are non-refundable, and custom products cannot be returned or exchanged.",
  },
  {
    key: "approvedOrder",
    label:
      "I am proceeding with payment for the proof, pricing, quantities, sizes, placement, spelling, and other order details I approved above.",
  },
  {
    key: "handmadeVariation",
    label:
      "I understand that custom and hand-finished products may have minor variations in placement, color, sizing, finish, or appearance, and digital colors may differ from physical materials.",
  },
  {
    key: "resolution",
    label:
      "If I am unhappy with my finished order, I will contact Moore Made so the issue can be reviewed. I understand Moore Made may offer a correction, repair, remake, replacement, or another reasonable solution when appropriate, but this does not create a right to a cash refund.",
  },
] as const;

export const FINAL_SALE_POLICY_SNAPSHOT = {
  version: FINAL_SALE_POLICY_VERSION,
  title: FINAL_SALE_POLICY_TITLE,
  summary: FINAL_SALE_POLICY_SUMMARY,
  acknowledgments: FINAL_SALE_POLICY_ACKNOWLEDGMENTS,
  rightsNotice:
    "These terms do not limit rights or remedies that cannot legally be waived.",
};
