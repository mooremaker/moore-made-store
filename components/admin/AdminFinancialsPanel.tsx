"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRequestNumber } from "@/lib/custom-request-types";
import {
  EXPENSE_CATEGORY_LABELS,
  paymentMethodLabel,
  receiptLabel,
  type BusinessExpenseCategory,
  type BusinessExpenseRow,
  type FinancialOrderSummary,
  type FinancialPaymentRow,
} from "@/lib/finance-types";
import { money, type QuoteRecord } from "@/lib/quote-types";

type Props = {
  orders: FinancialOrderSummary[];
  quotes: QuoteRecord[];
  payments: FinancialPaymentRow[];
  expenses: BusinessExpenseRow[];
};

function localDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Array<unknown>>) {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function AdminFinancialsPanel({ orders, quotes, payments, expenses }: Props) {
  const router = useRouter();
  const [savingExpense, setSavingExpense] = useState(false);
  const [expenseError, setExpenseError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploadingReceiptFor, setUploadingReceiptFor] = useState<string | null>(null);
  const [deletingReceiptId, setDeletingReceiptId] = useState<string | null>(null);

  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const quoteByRequest = useMemo(() => new Map(quotes.map((quote) => [quote.request_id, quote])), [quotes]);
  const paidPayments = useMemo(() => payments.filter((payment) => payment.status === "paid"), [payments]);
  const monthKey = currentMonthKey();

  const totals = useMemo(() => {
    const receivedAll = paidPayments.reduce((sum, payment) => sum + Number(payment.amount_cents || 0), 0);
    const receivedMonth = paidPayments
      .filter((payment) => (payment.paid_at || payment.created_at).slice(0, 7) === monthKey)
      .reduce((sum, payment) => sum + Number(payment.amount_cents || 0), 0);
    const expensesAll = expenses.reduce((sum, expense) => sum + Number(expense.amount_cents || 0), 0);
    const expensesMonth = expenses
      .filter((expense) => expense.expense_date.slice(0, 7) === monthKey)
      .reduce((sum, expense) => sum + Number(expense.amount_cents || 0), 0);
    // Cancelled orders remain in the database for history, but they are not active sales.
    // Keep actual paid/refunded transactions in the payment ledger; exclude cancelled
    // orders only from pipeline/value and outstanding-balance metrics.
    const activeOrderIds = new Set(orders.filter((order) => order.status !== "cancelled").map((order) => order.id));
    const approvedValue = quotes
      .filter((quote) => quote.status === "approved" && activeOrderIds.has(quote.request_id))
      .reduce((sum, quote) => sum + Number(quote.total_cents || 0), 0);
    const outstanding = orders.reduce((sum, order) => {
      if (order.status === "cancelled") return sum;
      const quote = quoteByRequest.get(order.id);
      if (!quote || quote.status !== "approved") return sum;
      return sum + Math.max(0, Number(quote.total_cents || 0) - Number(order.amount_paid_cents || 0));
    }, 0);
    return { receivedAll, receivedMonth, expensesAll, expensesMonth, approvedValue, outstanding, netMonth: receivedMonth - expensesMonth };
  }, [paidPayments, expenses, quotes, orders, quoteByRequest, monthKey]);

  const methodTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const payment of paidPayments) map.set(payment.payment_method, (map.get(payment.payment_method) || 0) + payment.amount_cents);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [paidPayments]);

  async function addExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingExpense(true);
    setExpenseError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const amount = Number(form.get("amount") || 0);
    form.set("amountCents", String(Math.round(amount * 100)));
    const response = await fetch("/api/admin/expenses", {
      method: "POST",
      body: form,
    });
    const data = await response.json().catch(() => ({}));
    setSavingExpense(false);
    if (!response.ok) { setExpenseError(data.error || "Could not save this expense."); return; }
    formElement.reset();
    router.refresh();
  }

  async function uploadReceipts(expenseId: string, fileList: FileList | null) {
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) return;
    setUploadingReceiptFor(expenseId);
    setExpenseError("");
    const form = new FormData();
    for (const file of files) form.append("receipts", file);
    const response = await fetch(`/api/admin/expenses/${expenseId}/receipts`, { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    setUploadingReceiptFor(null);
    if (!response.ok) { setExpenseError(data.error || "Could not upload the receipt."); return; }
    router.refresh();
  }

  async function deleteReceipt(expenseId: string, receiptId: string) {
    if (!window.confirm("Remove this receipt from the expense?")) return;
    setDeletingReceiptId(receiptId);
    setExpenseError("");
    const response = await fetch(`/api/admin/expenses/${expenseId}/receipts`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiptId }),
    });
    const data = await response.json().catch(() => ({}));
    setDeletingReceiptId(null);
    if (!response.ok) { setExpenseError(data.error || "Could not remove the receipt."); return; }
    router.refresh();
  }

  async function deleteExpense(id: string) {
    if (!window.confirm("Delete this expense entry?")) return;
    setDeletingId(id);
    const response = await fetch("/api/admin/expenses", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setDeletingId(null);
    if (!response.ok) { const data = await response.json().catch(() => ({})); setExpenseError(data.error || "Could not delete this expense."); return; }
    router.refresh();
  }

  function exportPayments() {
    downloadCsv("moore-made-payments.csv", [
      ["Receipt", "Date", "Order", "Customer", "Product", "Method", "Amount", "Reference"],
      ...paidPayments.map((payment) => {
        const order = orderById.get(payment.request_id);
        return [receiptLabel(payment.receipt_number), payment.paid_at || payment.created_at, order ? formatRequestNumber(order.request_number) : "", order?.customer_name || "", order?.product || "", paymentMethodLabel(payment.payment_method), (payment.amount_cents / 100).toFixed(2), payment.manual_reference || ""];
      }),
    ]);
  }

  function exportExpenses() {
    downloadCsv("moore-made-expenses.csv", [
      ["Date", "Vendor", "Category", "Description", "Amount", "Payment method", "Receipt files", "Note"],
      ...expenses.map((expense) => [expense.expense_date, expense.vendor, EXPENSE_CATEGORY_LABELS[expense.category], expense.description || "", (expense.amount_cents / 100).toFixed(2), expense.payment_method || "", (expense.receipts || []).map((receipt) => receipt.original_filename).join("; "), expense.note || ""]),
    ]);
  }

  return (
    <section className="adminWorkspacePanel adminFinancialsPanel">
      <div className="adminSectionIntro">
        <div><div className="eyebrow">Financials</div><h2>Money in, money out.</h2><p>Track customer payments, outstanding balances, receipts, and basic business expenses in one private workspace.</p></div>
        <div className="financeExportActions"><button type="button" className="btn secondary" onClick={exportPayments}>Export payments CSV</button><button type="button" className="btn secondary" onClick={exportExpenses}>Export expenses CSV</button></div>
      </div>

      <div className="financeMetricGrid">
        <div className="financeMetric"><span>Received this month</span><strong>{money(totals.receivedMonth)}</strong><small>Recorded paid transactions</small></div>
        <div className="financeMetric"><span>Expenses this month</span><strong>{money(totals.expensesMonth)}</strong><small>Manually recorded expenses</small></div>
        <div className="financeMetric"><span>Net cash this month</span><strong>{money(totals.netMonth)}</strong><small>Received minus recorded expenses</small></div>
        <div className="financeMetric"><span>Active outstanding</span><strong>{money(totals.outstanding)}</strong><small>Excludes cancelled orders</small></div>
        <div className="financeMetric"><span>Total received</span><strong>{money(totals.receivedAll)}</strong><small>All paid transactions</small></div>
        <div className="financeMetric"><span>Active approved value</span><strong>{money(totals.approvedValue)}</strong><small>Approved quotes, excluding cancelled orders</small></div>
      </div>

      <div className="financeTwoCol">
        <section className="card financePanelCard">
          <div className="financePanelHead"><div><div className="eyebrow">Payments</div><h3>Payment methods</h3></div></div>
          {methodTotals.length ? <div className="financeMethodList">{methodTotals.map(([method, amount]) => <div key={method}><span>{paymentMethodLabel(method)}</span><strong>{money(amount)}</strong></div>)}</div> : <p className="muted">No paid transactions yet.</p>}
        </section>

        <details className="card financePanelCard financeExpenseForm">
          <summary><div><div className="eyebrow">Expenses</div><h3>Add business expense</h3></div><span>+</span></summary>
          <form onSubmit={addExpense}>
            <div className="twoCol">
              <label className="field"><span>Date</span><input type="date" name="expenseDate" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
              <label className="field"><span>Amount</span><input type="number" name="amount" min="0.01" step="0.01" placeholder="0.00" required /></label>
            </div>
            <div className="twoCol">
              <label className="field"><span>Vendor / payee</span><input name="vendor" maxLength={160} required placeholder="Shirt supplier, USPS, software…" /></label>
              <label className="field"><span>Category</span><select name="category" defaultValue="materials">{Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            </div>
            <label className="field"><span>Description</span><input name="description" maxLength={500} placeholder="What was purchased?" /></label>
            <div className="twoCol">
              <label className="field"><span>Payment method</span><input name="paymentMethod" maxLength={100} placeholder="Business card, cash, etc." /></label>
              <label className="field"><span>Internal note</span><input name="note" maxLength={1000} placeholder="Optional" /></label>
            </div>
            <label className="field financeReceiptUploadField">
              <span>Receipt files <small>Optional</small></span>
              <input type="file" name="receipts" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif" />
              <small className="fieldHelp">Attach up to 10 receipt photos or PDFs, 20 MB each. You can also add receipts later.</small>
            </label>
            {expenseError ? <div className="formError">{expenseError}</div> : null}
            <button className="btn" type="submit" disabled={savingExpense}>{savingExpense ? "Saving…" : "Save expense"}</button>
          </form>
        </details>
      </div>

      <section className="financeTableSection">
        <div className="financeTableHead"><div><div className="eyebrow">Transactions</div><h3>Customer payments & receipts</h3></div><span>{paidPayments.length} paid</span></div>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Date</th><th>Receipt</th><th>Order / customer</th><th>Method</th><th>Amount</th><th /></tr></thead><tbody>{paidPayments.length ? paidPayments.map((payment) => { const order = orderById.get(payment.request_id); return <tr key={payment.id}><td>{localDate(payment.paid_at || payment.created_at)}</td><td>{receiptLabel(payment.receipt_number)}</td><td><strong>{order ? formatRequestNumber(order.request_number) : "Order"}</strong><small>{order?.customer_name || ""}{order?.product ? ` · ${order.product}` : ""}</small></td><td>{paymentMethodLabel(payment.payment_method)}</td><td><strong>{money(payment.amount_cents)}</strong></td><td>{payment.receipt_token ? <a className="btn secondary financeReceiptButton" href={`/receipt/${payment.receipt_token}`} target="_blank" rel="noreferrer">Receipt ↗</a> : "—"}</td></tr>; }) : <tr><td colSpan={6}>No paid transactions yet.</td></tr>}</tbody></table></div>
      </section>

      <section className="financeTableSection">
        <div className="financeTableHead"><div><div className="eyebrow">Expenses</div><h3>Recorded business expenses</h3></div><strong>{money(totals.expensesAll)}</strong></div>
        {expenseError ? <div className="formError financeTableError">{expenseError}</div> : null}
        <div className="financeTableWrap"><table className="financeTable financeExpenseTable"><thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Description</th><th>Receipts</th><th>Amount</th><th /></tr></thead><tbody>{expenses.length ? expenses.map((expense) => {
          const receipts = expense.receipts || [];
          return <tr key={expense.id}>
            <td>{localDate(`${expense.expense_date}T12:00:00`)}</td>
            <td><strong>{expense.vendor}</strong>{expense.payment_method ? <small>{expense.payment_method}</small> : null}</td>
            <td>{EXPENSE_CATEGORY_LABELS[expense.category]}</td>
            <td>{expense.description || expense.note || "—"}</td>
            <td>
              <div className="expenseReceiptCell">
                {receipts.map((receipt, index) => <span className="expenseReceiptChip" key={receipt.id}>
                  {receipt.url ? <a href={receipt.url} target="_blank" rel="noreferrer" title={receipt.original_filename}>Receipt {index + 1} ↗</a> : <span>Receipt {index + 1}</span>}
                  <button type="button" aria-label={`Remove ${receipt.original_filename}`} title="Remove receipt" disabled={deletingReceiptId === receipt.id} onClick={() => deleteReceipt(expense.id, receipt.id)}>×</button>
                </span>)}
                <label className={`expenseReceiptAdd ${uploadingReceiptFor === expense.id ? "isBusy" : ""}`}>
                  <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif" disabled={uploadingReceiptFor === expense.id} onChange={(event) => { void uploadReceipts(expense.id, event.currentTarget.files); event.currentTarget.value = ""; }} />
                  {uploadingReceiptFor === expense.id ? "Uploading…" : "+ Add receipt"}
                </label>
              </div>
            </td>
            <td><strong>{money(expense.amount_cents)}</strong></td>
            <td><button className="textButton financeDeleteButton" type="button" disabled={deletingId === expense.id} onClick={() => deleteExpense(expense.id)}>{deletingId === expense.id ? "Deleting…" : "Delete"}</button></td>
          </tr>;
        }) : <tr><td colSpan={7}>No business expenses recorded yet.</td></tr>}</tbody></table></div>
      </section>

      <p className="financeDisclaimer">Operational summary only. Keep your formal bookkeeping/tax records and professional accounting process separate as needed.</p>
    </section>
  );
}
