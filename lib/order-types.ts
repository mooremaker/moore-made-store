export type OrderSizeQuantity = Record<string, number>;

export type StructuredOrderItem = {
  id: string;
  productSlug: string;
  productName: string;
  colorName: string;
  customItemType?: string;
  customColorNotes?: string;
  quantities: OrderSizeQuantity;
  notes?: string;
  designRelationship?: "primary" | "same" | "separate";
};

export type ShippingAddress = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export function orderItemQuantity(item: StructuredOrderItem) {
  return Object.values(item.quantities || {}).reduce((sum, value) => sum + Math.max(0, Math.floor(Number(value) || 0)), 0);
}

export function orderItemsQuantity(items: StructuredOrderItem[]) {
  return items.reduce((sum, item) => sum + orderItemQuantity(item), 0);
}

export function compactSizeSummary(item: StructuredOrderItem) {
  return Object.entries(item.quantities || {})
    .filter(([, qty]) => Number(qty) > 0)
    .map(([size, qty]) => `${size} × ${qty}`)
    .join(", ");
}
