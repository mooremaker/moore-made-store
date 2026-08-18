"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { formatRequestNumber } from "@/lib/custom-request-types";
import {
  EXPENSE_CATEGORY_LABELS,
  FUNDING_ENTRY_TYPE_LABELS,
  FUNDING_PARTY_KIND_LABELS,
  paymentMethodLabel,
  receiptLabel,
  type BusinessExpenseRow,
  type BusinessFundingRow,
  type FinancialOrderSummary,
  type FinancialPaymentRow,
  type FundingEntryType,
} from "@/lib/finance-types";
import { money, type QuoteRecord } from "@/lib/quote-types";

type Props = {
  orders: FinancialOrderSummary[];
  quotes: QuoteRecord[];
  payments: FinancialPaymentRow[];
  expenses: BusinessExpenseRow[];
  funding: BusinessFundingRow[];
  fundingReady: boolean;
};

type QuickForm = "expense" | "funding" | null;

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

function fundingDirection(type: FundingEntryType) {
  if (["owner_contribution", "loan_received", "equity_investment"].includes(type)) return "in";
  if (["loan_repayment", "reimbursement_paid"].includes(type)) return "out";
  return "record";
}

export function AdminFinancialsPanel({ orders, quotes, payments, expenses, funding, fundingReady }: Props) {
  const router = useRouter();
  const [quickForm, setQuickForm] = useState<QuickForm>(null);
  const [savingExpense, setSavingExpense] = useState(false);
  const [savingFunding, setSavingFunding] = useState(false);
  const [fundingType, setFundingType] = useState<FundingEntryType>("owner_contribution");
  const [financeError, setFinanceError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploadingReceiptFor, setUploadingReceiptFor] = useState<string | null>(null);
  const [deletingReceiptId, setDeletingReceiptId] = useState<string | null>(null);
  const [voidingFundingId, setVoidingFundingId] = useState<string | null>(null);

  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const quoteByRequest = useMemo(() => new Map(quotes.map((quote) => [quote.request_id, quote])), [quotes]);
  const paidPayments = useMemo(() => payments.filter((payment) => payment.status === "paid"), [payments]);
  const activeFunding = useMemo(() => funding.filter((entry) => !entry.voided_at), [funding]);
  const monthKey = currentMonthKey();

  const totals = useMemo(() => {
    const receivedAll = paidPayments.reduce((sum, payment) => sum + Number(payment.amount_cents || 0), 0);
    const receivedMonth = paidPayments.filter((payment) => (payment.paid_at || payment.created_at).slice(0, 7) === monthKey).reduce((sum, payment) => sum + Number(payment.amount_cents || 0), 0);
    const expensesAll = expenses.reduce((sum, expense) => sum + Number(expense.amount_cents || 0), 0);
    const expensesMonth = expenses.filter((expense) => expense.expense_date.slice(0, 7) === monthKey).reduce((sum, expense) => sum + Number(expense.amount_cents || 0), 0);
    const activeOrderIds = new Set(orders.filter((order) => order.status !== "cancelled").map((order) => order.id));
    const approvedValue = quotes.filter((quote) => quote.status === "approved" && activeOrderIds.has(quote.request_id)).reduce((sum, quote) => sum + Number(quote.total_cents || 0), 0);
    const outstanding = orders.reduce((sum, order) => {
      if (order.status === "cancelled") return sum;
      const quote = quoteByRequest.get(order.id);
      if (!quote || quote.status !== "approved") return sum;
      return sum + Math.max(0, Number(quote.total_cents || 0) - Number(order.amount_paid_cents || 0));
    }, 0);
    const fundingIn = activeFunding.filter((entry) => fundingDirection(entry.entry_type) === "in").reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
    return { receivedAll, receivedMonth, expensesAll, expensesMonth, approvedValue, outstanding, netMonth: receivedMonth - expensesMonth, fundingIn };
  }, [paidPayments, expenses, quotes, orders, quoteByRequest, monthKey, activeFunding]);

  const fundingByParty = useMemo(() => {
    const map = new Map<string, { name: string; contributed: number; loans: number; loanRepaid: number; reimbursementsDue: number; reimbursementsPaid: number; equity: number }>();
    for (const entry of activeFunding) {
      const key = entry.party_name.trim().toLowerCase();
      const row = map.get(key) || { name: entry.party_name, contributed: 0, loans: 0, loanRepaid: 0, reimbursementsDue: 0, reimbursementsPaid: 0, equity: 0 };
      if (entry.entry_type === "owner_contribution") row.contributed += entry.amount_cents;
      if (entry.entry_type === "loan_received") row.loans += entry.amount_cents;
      if (entry.entry_type === "loan_repayment") row.loanRepaid += entry.amount_cents;
      if (entry.entry_type === "reimbursement_due") row.reimbursementsDue += entry.amount_cents;
      if (entry.entry_type === "reimbursement_paid") row.reimbursementsPaid += entry.amount_cents;
      if (entry.entry_type === "equity_investment") row.equity += entry.amount_cents;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [activeFunding]);

  async function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingExpense(true);
    setFinanceError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const amount = Number(form.get("amount") || 0);
    form.set("amountCents", String(Math.round(amount * 100)));
    const response = await fetch("/api/admin/expenses", { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    setSavingExpense(false);
    if (!response.ok) { setFinanceError(data.error || "Could not save this expense."); return; }
    formElement.reset();
    setQuickForm(null);
    router.refresh();
  }

  async function addFunding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingFunding(true);
    setFinanceError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const amount = Number(form.get("amount") || 0);
    form.set("amountCents", String(Math.round(amount * 100)));
    const response = await fetch("/api/admin/funding", { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    setSavingFunding(false);
    if (!response.ok) { setFinanceError(data.error || "Could not save this funding entry."); return; }
    formElement.reset();
    setFundingType("owner_contribution");
    setQuickForm(null);
    router.refresh();
  }

  async function voidFunding(id: string) {
    const reason = window.prompt("Why are you voiding this entry? The original record will stay in the audit history.", "Entered by mistake");
    if (reason === null) return;
    setVoidingFundingId(id);
    setFinanceError("");
    const response = await fetch("/api/admin/funding", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reason }) });
    const data = await response.json().catch(() => ({}));
    setVoidingFundingId(null);
    if (!response.ok) { setFinanceError(data.error || "Could not void this entry."); return; }
    router.refresh();
  }

  async function uploadReceipts(expenseId: string, fileList: FileList | null) {
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) return;
    setUploadingReceiptFor(expenseId);
    setFinanceError("");
    const form = new FormData();
    for (const file of files) form.append("receipts", file);
    const response = await fetch(`/api/admin/expenses/${expenseId}/receipts`, { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    setUploadingReceiptFor(null);
    if (!response.ok) { setFinanceError(data.error || "Could not upload the receipt."); return; }
    router.refresh();
  }

  async function deleteReceipt(expenseId: string, receiptId: string) {
    if (!window.confirm("Remove this receipt from the expense?")) return;
    setDeletingReceiptId(receiptId);
    setFinanceError("");
    const response = await fetch(`/api/admin/expenses/${expenseId}/receipts`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receiptId }) });
    const data = await response.json().catch(() => ({}));
    setDeletingReceiptId(null);
    if (!response.ok) { setFinanceError(data.error || "Could not remove the receipt."); return; }
    router.refresh();
  }

  async function deleteExpense(id: string) {
    if (!window.confirm("Delete this expense entry?")) return;
    setDeletingId(id);
    const response = await fetch("/api/admin/expenses", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setDeletingId(null);
    if (!response.ok) { const data = await response.json().catch(() => ({})); setFinanceError(data.error || "Could not delete this expense."); return; }
    router.refresh();
  }

  function exportPayments() {
    downloadCsv("moore-made-payments.csv", [["Receipt", "Date", "Order", "Customer", "Product", "Method", "Amount", "Reference"], ...paidPayments.map((payment) => { const order = orderById.get(payment.request_id); return [receiptLabel(payment.receipt_number), payment.paid_at || payment.created_at, order ? formatRequestNumber(order.request_number) : "", order?.customer_name || "", order?.product || "", paymentMethodLabel(payment.payment_method), (payment.amount_cents / 100).toFixed(2), payment.manual_reference || ""]; })]);
  }

  function exportExpenses() {
    downloadCsv("moore-made-expenses.csv", [["Date", "Vendor", "Category", "Description", "Amount", "Payment method", "Receipt files", "Note"], ...expenses.map((expense) => [expense.expense_date, expense.vendor, EXPENSE_CATEGORY_LABELS[expense.category], expense.description || "", (expense.amount_cents / 100).toFixed(2), expense.payment_method || "", (expense.receipts || []).map((receipt) => receipt.original_filename).join("; "), expense.note || ""])]);
  }

  function exportFunding() {
    downloadCsv("moore-made-funding-ledger.csv", [["Date", "Person / source", "Relationship", "Type", "Amount", "Ownership %", "Method", "Reference", "Documents", "Note", "Status"], ...funding.map((entry) => [entry.entry_date, entry.party_name, FUNDING_PARTY_KIND_LABELS[entry.party_kind], FUNDING_ENTRY_TYPE_LABELS[entry.entry_type], (entry.amount_cents / 100).toFixed(2), entry.ownership_percent ?? "", entry.payment_method || "", entry.reference || "", (entry.documents || []).map((document) => document.original_filename).join("; "), entry.note || "", entry.voided_at ? `VOID — ${entry.void_reason || ""}` : "Active"])]);
  }

  function exportAccounting() {
    const rows: Array<Array<unknown>> = [["Date", "Record type", "Name", "Category", "Memo", "Money in", "Money out", "Method", "Reference"]];
    for (const payment of paidPayments) {
      const order = orderById.get(payment.request_id);
      rows.push([(payment.paid_at || payment.created_at).slice(0, 10), "Customer payment", order?.customer_name || "Customer", "Sales income", order ? `${formatRequestNumber(order.request_number)} · ${order.product}` : "Customer payment", (payment.amount_cents / 100).toFixed(2), "", paymentMethodLabel(payment.payment_method), payment.manual_reference || receiptLabel(payment.receipt_number)]);
    }
    for (const expense of expenses) rows.push([expense.expense_date, "Business expense", expense.vendor, EXPENSE_CATEGORY_LABELS[expense.category], expense.description || expense.note || "", "", (expense.amount_cents / 100).toFixed(2), expense.payment_method || "", ""]);
    for (const entry of activeFunding) {
      const direction = fundingDirection(entry.entry_type);
      if (direction === "record") continue;
      rows.push([entry.entry_date, "Funding", entry.party_name, FUNDING_ENTRY_TYPE_LABELS[entry.entry_type], entry.note || "", direction === "in" ? (entry.amount_cents / 100).toFixed(2) : "", direction === "out" ? (entry.amount_cents / 100).toFixed(2) : "", entry.payment_method || "", entry.reference || ""]);
    }
    downloadCsv("moore-made-accounting-export.csv", rows);
  }

  return (
    <section className="adminWorkspacePanel adminFinancialsPanel">
      <div className="adminSectionIntro financeIntroRedesign">
        <div><div className="eyebrow">Financials</div><h2>Everything money-related, in one place.</h2><p>Track sales, expenses, owner contributions, family funding, loans, reimbursements, and supporting documents without hunting through the admin.</p></div>
        <div className="financeExportActions"><button type="button" className="btn secondary" onClick={exportAccounting}>Export accounting CSV</button><button type="button" className="textButton" onClick={exportPayments}>Payments CSV</button><button type="button" className="textButton" onClick={exportExpenses}>Expenses CSV</button>{fundingReady ? <button type="button" className="textButton" onClick={exportFunding}>Funding CSV</button> : null}</div>
      </div>

      <div className="financeQuickActions" aria-label="Financial quick actions">
        <button className={quickForm === "expense" ? "active" : ""} type="button" onClick={() => setQuickForm(quickForm === "expense" ? null : "expense")}><span>−</span><strong>Add expense</strong><small>Purchase, fee, supplies</small></button>
        <button className={quickForm === "funding" ? "active" : ""} type="button" disabled={!fundingReady} onClick={() => setQuickForm(quickForm === "funding" ? null : "funding")}><span>+</span><strong>Add funding</strong><small>Contribution, loan, reimbursement</small></button>
        <button type="button" onClick={exportAccounting}><span>⇩</span><strong>Export books</strong><small>Accounting-friendly CSV</small></button>
      </div>

      {!fundingReady ? <div className="requestNote"><strong>Funding ledger needs one database update.</strong> Run <code>supabase/moore_made_phase6_12_funding_ledger.sql</code>. Your existing payments and expenses continue to work normally.</div> : null}
      {financeError ? <div className="formError financeTableError">{financeError}</div> : null}

      {quickForm === "expense" ? <section className="card financeQuickFormCard">
        <div className="financePanelHead"><div><div className="eyebrow">New expense</div><h3>Record money Moore Made spent.</h3></div><button type="button" className="textButton" onClick={() => setQuickForm(null)}>Close</button></div>
        <form onSubmit={addExpense}>
          <div className="twoCol"><label className="field"><span>Date</span><input type="date" name="expenseDate" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label className="field"><span>Amount</span><input type="number" name="amount" min="0.01" step="0.01" placeholder="0.00" required /></label></div>
          <div className="twoCol"><label className="field"><span>Vendor / payee</span><input name="vendor" maxLength={160} required placeholder="Shirt supplier, USPS, software…" /></label><label className="field"><span>Category</span><select name="category" defaultValue="materials">{Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
          <label className="field"><span>Description</span><input name="description" maxLength={500} placeholder="What was purchased?" /></label>
          <div className="twoCol"><label className="field"><span>Payment method</span><input name="paymentMethod" maxLength={100} placeholder="Business card, cash, etc." /></label><label className="field"><span>Internal note</span><input name="note" maxLength={1000} placeholder="Optional" /></label></div>
          <label className="field financeReceiptUploadField"><span>Receipt files <small>Optional</small></span><input type="file" name="receipts" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif" /><small className="fieldHelp">Up to 10 receipt photos or PDFs, 20 MB each.</small></label>
          <button className="btn" type="submit" disabled={savingExpense}>{savingExpense ? "Saving…" : "Save expense"}</button>
        </form>
      </section> : null}

      {quickForm === "funding" && fundingReady ? <section className="card financeQuickFormCard">
        <div className="financePanelHead"><div><div className="eyebrow">New funding entry</div><h3>Record money between a person and Moore Made.</h3></div><button type="button" className="textButton" onClick={() => setQuickForm(null)}>Close</button></div>
        <form onSubmit={addFunding}>
          <div className="twoCol"><label className="field"><span>Date</span><input type="date" name="entryDate" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label className="field"><span>Amount</span><input type="number" name="amount" min="0.01" step="0.01" placeholder="0.00" required /></label></div>
          <div className="twoCol"><label className="field"><span>Person / funding source</span><input name="partyName" required placeholder="Salvatore, Matthew, Mom, Aunt Jane…" /></label><label className="field"><span>Relationship</span><select name="partyKind" defaultValue="member">{Object.entries(FUNDING_PARTY_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          <label className="field"><span>What happened?</span><select name="entryType" value={fundingType} onChange={(event) => setFundingType(event.target.value as FundingEntryType)}>{Object.entries(FUNDING_ENTRY_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {fundingType === "equity_investment" ? <div className="fundingLegalWarning"><strong>Equity changes ownership.</strong><span>Only use this after the ownership deal and legal paperwork are completed. Recording it here does not itself make someone an owner.</span><label className="field"><span>Ownership % documented</span><input name="ownershipPercent" type="number" min="0" max="100" step="0.01" placeholder="Example: 5" required /></label></div> : null}
          {fundingType === "needs_classification" ? <div className="requestNote"><strong>Good choice when you are unsure.</strong> Save the money movement now and have your accountant classify it before tax filing.</div> : null}
          <div className="twoCol"><label className="field"><span>Payment method</span><input name="paymentMethod" placeholder="Transfer, check, cash…" /></label><label className="field"><span>Reference</span><input name="reference" placeholder="Transfer memo, check #, agreement #…" /></label></div>
          <label className="field"><span>Note</span><textarea name="note" placeholder="What was this money for? What did everyone agree to?" /></label>
          <label className="field"><span>Agreement / supporting documents <small>Optional</small></span><input name="documents" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif" /><small className="fieldHelp">Attach up to 5 signed agreements, receipts, checks, or supporting files, 20 MB each.</small></label>
          <button className="btn" type="submit" disabled={savingFunding}>{savingFunding ? "Saving…" : "Save funding entry"}</button>
        </form>
      </section> : null}

      <div className="financeMetricGrid financeMetricGridCompact">
        <div className="financeMetric"><span>Sales received this month</span><strong>{money(totals.receivedMonth)}</strong><small>Customer payments</small></div>
        <div className="financeMetric"><span>Expenses this month</span><strong>{money(totals.expensesMonth)}</strong><small>Recorded business expenses</small></div>
        <div className="financeMetric"><span>Operating cash this month</span><strong>{money(totals.netMonth)}</strong><small>Sales received minus expenses</small></div>
        <div className="financeMetric"><span>Outstanding customer balances</span><strong>{money(totals.outstanding)}</strong><small>Approved active orders</small></div>
        {fundingReady ? <div className="financeMetric"><span>Total outside/owner funding in</span><strong>{money(totals.fundingIn)}</strong><small>Not counted as sales</small></div> : null}
      </div>

      {fundingReady ? <section className="fundingOverview card">
        <div className="financePanelHead"><div><div className="eyebrow">Ownership & funding</div><h3>Keep ownership separate from who put in more cash.</h3></div><span className="ownershipLock">Ownership: Salvatore 50% · Matthew 50%</span></div>
        <p className="fieldHelp">Funding entries do not automatically change ownership. Loans and reimbursements track what Moore Made owes back.</p>
        {fundingByParty.length ? <div className="fundingPartyGrid">{fundingByParty.map((party) => {
          const loanOwed = Math.max(0, party.loans - party.loanRepaid);
          const reimbursementOwed = Math.max(0, party.reimbursementsDue - party.reimbursementsPaid);
          return <article key={party.name}><strong>{party.name}</strong><div><span>Contributed</span><b>{money(party.contributed)}</b></div><div><span>Loans owed back</span><b>{money(loanOwed)}</b></div><div><span>Reimbursements owed</span><b>{money(reimbursementOwed)}</b></div>{party.equity ? <div><span>Equity funding recorded</span><b>{money(party.equity)}</b></div> : null}</article>;
        })}</div> : <p className="muted">No funding entries yet. Use <strong>Add funding</strong> above when an owner or family member puts money in, lends money, or needs to be reimbursed.</p>}
      </section> : null}

      <section className="financeTableSection">
        <div className="financeTableHead"><div><div className="eyebrow">Customer money</div><h3>Payments & receipts</h3></div><span>{paidPayments.length} paid · {money(totals.receivedAll)} total</span></div>
        <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Date</th><th>Receipt</th><th>Order / customer</th><th>Method</th><th>Amount</th><th /></tr></thead><tbody>{paidPayments.length ? paidPayments.map((payment) => { const order = orderById.get(payment.request_id); return <tr key={payment.id}><td>{localDate(payment.paid_at || payment.created_at)}</td><td>{receiptLabel(payment.receipt_number)}</td><td><strong>{order ? formatRequestNumber(order.request_number) : "Order"}</strong><small>{order?.customer_name || ""}{order?.product ? ` · ${order.product}` : ""}</small></td><td>{paymentMethodLabel(payment.payment_method)}</td><td><strong>{money(payment.amount_cents)}</strong></td><td>{payment.receipt_token ? <a className="btn secondary financeReceiptButton" href={`/receipt/${payment.receipt_token}`} target="_blank" rel="noreferrer">Receipt ↗</a> : "—"}</td></tr>; }) : <tr><td colSpan={6}>No paid transactions yet.</td></tr>}</tbody></table></div>
      </section>

      <section className="financeTableSection">
        <div className="financeTableHead"><div><div className="eyebrow">Business spending</div><h3>Expenses</h3></div><strong>{money(totals.expensesAll)}</strong></div>
        <div className="financeTableWrap"><table className="financeTable financeExpenseTable"><thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Description</th><th>Receipts</th><th>Amount</th><th /></tr></thead><tbody>{expenses.length ? expenses.map((expense) => {
          const receipts = expense.receipts || [];
          return <tr key={expense.id}><td>{localDate(`${expense.expense_date}T12:00:00`)}</td><td><strong>{expense.vendor}</strong>{expense.payment_method ? <small>{expense.payment_method}</small> : null}</td><td>{EXPENSE_CATEGORY_LABELS[expense.category]}</td><td>{expense.description || expense.note || "—"}</td><td><div className="expenseReceiptCell">{receipts.map((receipt, index) => <span className="expenseReceiptChip" key={receipt.id}>{receipt.url ? <a href={receipt.url} target="_blank" rel="noreferrer" title={receipt.original_filename}>Receipt {index + 1} ↗</a> : <span>Receipt {index + 1}</span>}<button type="button" aria-label={`Remove ${receipt.original_filename}`} title="Remove receipt" disabled={deletingReceiptId === receipt.id} onClick={() => deleteReceipt(expense.id, receipt.id)}>×</button></span>)}<label className={`expenseReceiptAdd ${uploadingReceiptFor === expense.id ? "isBusy" : ""}`}><input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif" disabled={uploadingReceiptFor === expense.id} onChange={(event) => { void uploadReceipts(expense.id, event.currentTarget.files); event.currentTarget.value = ""; }} />{uploadingReceiptFor === expense.id ? "Uploading…" : "+ Receipt"}</label></div></td><td><strong>{money(expense.amount_cents)}</strong></td><td><button className="textButton financeDeleteButton" type="button" disabled={deletingId === expense.id} onClick={() => deleteExpense(expense.id)}>{deletingId === expense.id ? "Deleting…" : "Delete"}</button></td></tr>;
        }) : <tr><td colSpan={7}>No business expenses recorded yet.</td></tr>}</tbody></table></div>
      </section>

      {fundingReady ? <section className="financeTableSection">
        <div className="financeTableHead"><div><div className="eyebrow">Funding audit trail</div><h3>Owner, family & outside money</h3></div><span>{activeFunding.length} active entries</span></div>
        <div className="financeTableWrap"><table className="financeTable fundingTable"><thead><tr><th>Date</th><th>Person</th><th>Type</th><th>Documents</th><th>Amount</th><th /></tr></thead><tbody>{funding.length ? funding.map((entry) => <tr key={entry.id} className={entry.voided_at ? "isVoided" : ""}><td>{localDate(`${entry.entry_date}T12:00:00`)}</td><td><strong>{entry.party_name}</strong><small>{FUNDING_PARTY_KIND_LABELS[entry.party_kind]}{entry.reference ? ` · ${entry.reference}` : ""}</small></td><td>{FUNDING_ENTRY_TYPE_LABELS[entry.entry_type]}{entry.ownership_percent != null ? <small>{entry.ownership_percent}% ownership documented</small> : null}{entry.note ? <small>{entry.note}</small> : null}</td><td><div className="fundingDocumentList">{(entry.documents || []).length ? (entry.documents || []).map((document, index) => document.url ? <a key={document.id} href={document.url} target="_blank" rel="noreferrer">Doc {index + 1} ↗</a> : <span key={document.id}>Doc {index + 1}</span>) : "—"}</div></td><td><strong>{money(entry.amount_cents)}</strong>{entry.voided_at ? <small>VOID</small> : null}</td><td>{entry.voided_at ? <span className="fieldHelp">{entry.void_reason || "Voided"}</span> : <button className="textButton financeDeleteButton" type="button" disabled={voidingFundingId === entry.id} onClick={() => voidFunding(entry.id)}>{voidingFundingId === entry.id ? "Voiding…" : "Void"}</button>}</td></tr>) : <tr><td colSpan={6}>No funding entries recorded yet.</td></tr>}</tbody></table></div>
      </section> : null}

      <p className="financeDisclaimer">This portal is your internal source-of-truth ledger and export workspace. It is not a substitute for tax/legal advice; use the exports with QuickBooks or your accountant when you are ready.</p>
    </section>
  );
}
