export type OrderWorksheetColumn = {
  id: string;
  label: string;
  required?: boolean;
  customerVisible?: boolean;
};

export type OrderWorksheetRow = {
  id: string;
  values: Record<string, string>;
};

export type OrderWorksheetRecord = {
  id: string;
  request_id: string;
  public_token: string;
  title: string;
  instructions: string | null;
  columns: OrderWorksheetColumn[];
  rows: OrderWorksheetRow[];
  is_open: boolean;
  last_sent_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export const DEFAULT_ORDER_WORKSHEET_COLUMNS: OrderWorksheetColumn[] = [
  { id: "employee_name", label: "Employee name", required: true, customerVisible: true },
  { id: "shirt_size", label: "Shirt size", required: true, customerVisible: true },
  { id: "back_name_requested", label: "Last name on back?", customerVisible: true },
  { id: "back_name", label: "Last name for back", customerVisible: true },
];

export function newWorksheetRow(columns: OrderWorksheetColumn[]): OrderWorksheetRow {
  return { id: crypto.randomUUID(), values: Object.fromEntries(columns.map((column) => [column.id, ""])) };
}

export function normalizeWorksheetColumns(value: unknown): OrderWorksheetColumn[] {
  if (!Array.isArray(value)) return DEFAULT_ORDER_WORKSHEET_COLUMNS;
  const columns = value.map((column, index) => {
    const source = column && typeof column === "object" ? column as Record<string, unknown> : {};
    const label = String(source.label || "").trim();
    return { id: String(source.id || `column_${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60), label: label.slice(0, 80), required: Boolean(source.required), customerVisible: source.customerVisible !== false };
  }).filter((column) => column.id && column.label);
  return columns.length ? columns : DEFAULT_ORDER_WORKSHEET_COLUMNS;
}

export function normalizeWorksheetRows(value: unknown, columns: OrderWorksheetColumn[]): OrderWorksheetRow[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).map((row, index) => {
    const source = row && typeof row === "object" ? row as Record<string, unknown> : {};
    const values = source.values && typeof source.values === "object" ? source.values as Record<string, unknown> : {};
    return { id: String(source.id || `row_${index + 1}`).slice(0, 100), values: Object.fromEntries(columns.map((column) => [column.id, String(values[column.id] || "").slice(0, 200)])) };
  });
}
