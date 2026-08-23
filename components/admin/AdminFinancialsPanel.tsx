"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminDiscountCodesPanel } from "@/components/admin/AdminDiscountCodesPanel";
import type { DiscountCodeRecord } from "@/lib/discount-types";
import { formatRequestNumber } from "@/lib/custom-request-types";
import type { AdminUserOption } from "@/lib/message-types";
import {
  BUSINESS_GOAL_PRIORITY_LABELS,
  BUSINESS_GOAL_STATUS_LABELS,
  EXPENSE_CATEGORY_LABELS,
  FUNDING_ENTRY_TYPE_LABELS,
  FUNDING_PARTY_KIND_LABELS,
  paymentMethodLabel,
  receiptLabel,
  type BusinessExpenseRow,
  type BusinessFinanceAuditRow,
  type BusinessFundingRow,
  type BusinessGoalPriority,
  type BusinessGoalRow,
  type BusinessGoalStatus,
  type FinancialOrderSummary,
  type FinancialPaymentRow,
  type FundingEntryType,
} from "@/lib/finance-types";
import { money, type QuoteRecord } from "@/lib/quote-types";
import type { BusinessSettingsRecord } from "@/lib/pricing-types";

type Props = {
  orders: FinancialOrderSummary[];
  quotes: QuoteRecord[];
  payments: FinancialPaymentRow[];
  expenses: BusinessExpenseRow[];
  funding: BusinessFundingRow[];
  goals: BusinessGoalRow[];
  financeAudit: BusinessFinanceAuditRow[];
  adminUsers: AdminUserOption[];
  fundingReady: boolean;
  goalsReady: boolean;
  auditReady: boolean;
  discountCodes: DiscountCodeRecord[];
  discountsReady: boolean;
  businessSettings?: BusinessSettingsRecord | null;
  onOpenOrder: (requestId: string) => void;
};

type QuickForm = "expense" | "funding" | "goal" | null;
type FinanceView = "overview" | "goals" | "transactions" | "funding" | "discounts" | "tax";
type GoalFundingAction = { goalId: string; direction: "allocate" | "withdraw" } | null;
type EarningsPeriod = "week" | "14days" | "month" | "year" | "all";
type GoalPeriod = "week" | "month" | "year";

const GOAL_PRIORITY_RANK: Record<BusinessGoalPriority, number> = { critical: 0, high: 1, medium: 2, future: 3 };
const GOAL_PRIORITY_GUIDANCE: Record<BusinessGoalPriority, string> = {
  critical: "Critical — needed to keep current production operating",
  high: "High — important near-term capacity or growth",
  medium: "Medium — useful improvement after urgent goals",
  future: "Future — longer-term wish list",
};

function localDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(new Date(value));
}

function localDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(value));
}

function monthKeyForNewYork(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? String(date.getFullYear());
  const month = parts.find((part) => part.type === "month")?.value ?? String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function currentMonthKey() {
  return monthKeyForNewYork(new Date());
}

function dateKeyForNewYork(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((row) => row.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function currentEasternWeek() {
  const todayKey = dateKeyForNewYork(new Date());
  const noonUtc = new Date(`${todayKey}T12:00:00Z`);
  const mondayOffset = (noonUtc.getUTCDay() + 6) % 7;
  const start = new Date(noonUtc);
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const startKey = start.toISOString().slice(0, 10);
  const endKey = end.toISOString().slice(0, 10);
  const label = `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(start)}–${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(end)}`;
  return { startKey, endKey, label };
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
  if (["owner_contribution", "loan_received", "equity_investment", "gift_received"].includes(type)) return "in";
  if (["owner_draw", "loan_repayment", "reimbursement_paid"].includes(type)) return "out";
  return "record";
}

function ownerDrawRecipient(name: string) {
  const normalized = name.trim().toLowerCase();
  if (normalized.includes("sal")) return "sal";
  if (normalized.includes("matt")) return "matt";
  return "unassigned";
}

function paymentTaxCollected(payment: FinancialPaymentRow) {
  const orderTax = Math.max(0, Number(payment.order_tax_cents || 0));
  const orderTotal = Math.max(0, Number(payment.order_total_cents || 0));
  const amount = Math.max(0, Number(payment.amount_cents || 0));
  if (!orderTax || !orderTotal) return 0;
  return Math.min(amount, Math.round(amount / orderTotal * orderTax));
}

function paymentSalesRevenue(payment: FinancialPaymentRow) {
  return Math.max(0, Number(payment.amount_cents || 0) - paymentTaxCollected(payment));
}

function paymentStripeFee(payment: FinancialPaymentRow) {
  return payment.payment_method === "stripe" ? Math.max(0, Number(payment.stripe_fee_cents || 0)) : 0;
}

function goalSaved(goal: BusinessGoalRow) {
  return (goal.funding_entries || []).reduce((sum, entry) => sum + (entry.direction === "allocate" ? entry.amount_cents : -entry.amount_cents), 0);
}

function sixMonthKeys() {
  const result: Array<{ key: string; label: string }> = [];
  const now = new Date();
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    result.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: new Intl.DateTimeFormat("en-US", { month: "short" }).format(date),
    });
  }
  return result;
}

function auditEntityLabel(value: string) {
  const labels: Record<string, string> = {
    payments: "Payment",
    business_expenses: "Expense",
    business_expense_receipts: "Expense receipt",
    business_funding_entries: "Funding entry",
    business_funding_documents: "Funding document",
    business_goals: "Business goal",
    business_goal_funding: "Goal funding",
  };
  return labels[value] || value.replaceAll("_", " ");
}

function auditActionLabel(value: string) {
  if (value === "insert") return "Created";
  if (value === "update") return "Updated";
  if (value === "delete") return "Removed";
  if (value === "void") return "Voided";
  if (value === "status_change") return "Status changed";
  return value.replaceAll("_", " ");
}

function auditSummary(entry: BusinessFinanceAuditRow) {
  const data = entry.after_data || entry.before_data || {};
  const amount = Number(data.amount_cents || data.target_amount_cents || 0);
  if (entry.entity_type === "business_expenses") return `${String(data.vendor || "Expense")}${amount ? ` · ${money(amount)}` : ""}`;
  if (entry.entity_type === "business_funding_entries") return `${String(data.party_name || "Funding")}${amount ? ` · ${money(amount)}` : ""}`;
  if (entry.entity_type === "business_goals") return `${String(data.name || "Goal")}${amount ? ` · ${money(amount)}` : ""}`;
  if (entry.entity_type === "business_goal_funding") return `${String(data.direction || "Goal funding")}${amount ? ` · ${money(amount)}` : ""}`;
  if (entry.entity_type.includes("receipt") || entry.entity_type.includes("document")) return String(data.original_filename || "Supporting document");
  if (entry.entity_type === "payments") return amount ? money(amount) : "Customer payment";
  return auditEntityLabel(entry.entity_type);
}

function FinanceTrendChart({ rows }: { rows: Array<{ label: string; revenue: number; expenses: number; net: number }> }) {
  const max = Math.max(1, ...rows.flatMap((row) => [row.revenue, row.expenses]));
  return (
    <div className="financeTrendChart" aria-label="Six month revenue and expense trend">
      <div className="financeChartLegend"><span><i className="revenueDot" />Revenue</span><span><i className="expenseDot" />Expenses</span></div>
      <div className="financeTrendPlot">
        {rows.map((row) => (
          <div className="financeTrendMonth" key={row.label}>
            <div className="financeTrendBars" title={`${row.label}: ${money(row.revenue)} revenue, ${money(row.expenses)} expenses`}>
              <span className="financeTrendBar revenue" style={{ height: `${Math.max(row.revenue ? 5 : 1, (row.revenue / max) * 100)}%` }} />
              <span className="financeTrendBar expense" style={{ height: `${Math.max(row.expenses ? 5 : 1, (row.expenses / max) * 100)}%` }} />
            </div>
            <strong>{row.label}</strong>
            <small className={row.net < 0 ? "negative" : ""}>{money(row.net)} net</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeeklyGoalBar({ label, current, goal, tone }: { label: string; current: number; goal: number; tone: "sales" | "profit" }) {
  const percentage = goal > 0 ? current / goal * 100 : 0;
  const remaining = Math.max(0, goal - current);
  const reached = goal > 0 && current >= goal;
  return <div className={`weeklyGoalBar is-${tone}`}>
    <div className="weeklyGoalBarHead"><div><strong>{label}</strong><span>{money(current)} of {money(goal)}</span></div><div><strong>{percentage.toFixed(1)}%</strong><span>{reached ? "Goal reached" : `${money(remaining)} remaining`}</span></div></div>
    <div className="weeklyGoalTrack" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(percentage))}><span style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }} /></div>
    {percentage > 100 ? <small>{(percentage - 100).toFixed(1)}% above goal</small> : null}
  </div>;
}

export function AdminFinancialsPanel({ orders, quotes, payments, expenses, funding, goals, financeAudit, adminUsers, fundingReady, goalsReady, auditReady, discountCodes, discountsReady, businessSettings = null, onOpenOrder }: Props) {
  const router = useRouter();
  const [view, setView] = useState<FinanceView>("overview");
  const [quickForm, setQuickForm] = useState<QuickForm>(null);
  const [savingExpense, setSavingExpense] = useState(false);
  const [savingFunding, setSavingFunding] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);
  const [fundingType, setFundingType] = useState<FundingEntryType>("gift_received");
  const [financeError, setFinanceError] = useState("");
  const [voidingExpenseId, setVoidingExpenseId] = useState<string | null>(null);
  const [uploadingReceiptFor, setUploadingReceiptFor] = useState<string | null>(null);
  const [deletingReceiptId, setDeletingReceiptId] = useState<string | null>(null);
  const [voidingFundingId, setVoidingFundingId] = useState<string | null>(null);
  const [voidingGoalId, setVoidingGoalId] = useState<string | null>(null);
  const [goalFundingAction, setGoalFundingAction] = useState<GoalFundingAction>(null);
  const [goalFundingSaving, setGoalFundingSaving] = useState(false);
  const [goalStatusSaving, setGoalStatusSaving] = useState<string | null>(null);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalEditSaving, setGoalEditSaving] = useState(false);
  const [syncingPaymentId, setSyncingPaymentId] = useState<string | null>(null);
  const [focusedPaymentId, setFocusedPaymentId] = useState<string | null>(null);
  const [earningsPeriod, setEarningsPeriod] = useState<EarningsPeriod>("week");
  const [goalPeriod, setGoalPeriod] = useState<GoalPeriod>("week");
  const quickFormRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!quickForm) return;
    const frame = window.requestAnimationFrame(() => {
      quickFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [quickForm, view]);

  useEffect(() => {
    if (view !== "transactions" || !focusedPaymentId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`payment-${focusedPaymentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedPaymentId, view]);

  function openQuickForm(form: Exclude<QuickForm, null>, targetView: FinanceView) {
    setView(targetView);
    if (quickForm === form) {
      quickFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setQuickForm(form);
  }

  function openOwnerDraw() {
    setFundingType("owner_draw");
    openQuickForm("funding", "funding");
  }

  async function syncStripeSettlement(paymentId: string) {
    setSyncingPaymentId(paymentId);
    setFinanceError("");
    const response = await fetch("/api/admin/payments/settlement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId }) });
    const data = await response.json().catch(() => ({}));
    setSyncingPaymentId(null);
    if (!response.ok) { setFinanceError(data.error || "Could not sync Stripe settlement details."); return; }
    router.refresh();
  }

  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const quoteByRequest = useMemo(() => new Map(quotes.map((quote) => [quote.request_id, quote])), [quotes]);
  const adminById = useMemo(() => new Map(adminUsers.map((admin) => [admin.id, admin.name || admin.email])), [adminUsers]);
  const paidPayments = useMemo(() => payments.filter((payment) => payment.status === "paid"), [payments]);
  const activeExpenses = useMemo(() => expenses.filter((expense) => !expense.voided_at), [expenses]);
  const activeFunding = useMemo(() => funding.filter((entry) => !entry.voided_at), [funding]);
  const activeGoals = useMemo(() => goals.filter((goal) => !goal.voided_at), [goals]);
  const sortedActiveGoals = useMemo(() => [...activeGoals].sort((a, b) => {
    const priorityDifference = GOAL_PRIORITY_RANK[a.priority] - GOAL_PRIORITY_RANK[b.priority];
    if (priorityDifference) return priorityDifference;
    if (a.target_date && b.target_date && a.target_date !== b.target_date) return a.target_date.localeCompare(b.target_date);
    if (a.target_date) return -1;
    if (b.target_date) return 1;
    return a.created_at.localeCompare(b.created_at);
  }), [activeGoals]);
  const monthKey = currentMonthKey();
  const easternWeek = currentEasternWeek();
  const currentTaxYear = dateKeyForNewYork(new Date()).slice(0, 4);
  const unreconciledStripePayments = useMemo(() => paidPayments.filter((payment) =>
    dateKeyForNewYork(payment.paid_at || payment.created_at).startsWith(currentTaxYear)
    && payment.payment_method === "stripe"
    && payment.stripe_fee_cents == null
  ), [paidPayments, currentTaxYear]);

  function openFeeReconciliation() {
    setQuickForm(null);
    setFocusedPaymentId(unreconciledStripePayments[0]?.id || null);
    setView("transactions");
  }

  const totals = useMemo(() => {
    const receivedAll = paidPayments.reduce((sum, payment) => sum + Number(payment.amount_cents || 0), 0);
    const monthPayments = paidPayments.filter((payment) => monthKeyForNewYork(payment.paid_at || payment.created_at) === monthKey);
    const receivedMonth = monthPayments.reduce((sum, payment) => sum + Number(payment.amount_cents || 0), 0);
    const salesTaxAll = paidPayments.reduce((sum, payment) => sum + paymentTaxCollected(payment), 0);
    const salesTaxMonth = monthPayments.reduce((sum, payment) => sum + paymentTaxCollected(payment), 0);
    const salesRevenueAll = paidPayments.reduce((sum, payment) => sum + paymentSalesRevenue(payment), 0);
    const salesRevenueMonth = monthPayments.reduce((sum, payment) => sum + paymentSalesRevenue(payment), 0);
    const stripeFeesAll = paidPayments.reduce((sum, payment) => sum + paymentStripeFee(payment), 0);
    const stripeFeesMonth = monthPayments.reduce((sum, payment) => sum + paymentStripeFee(payment), 0);
    const expensesAll = activeExpenses.reduce((sum, expense) => sum + Number(expense.amount_cents || 0), 0);
    const expensesMonth = activeExpenses.filter((expense) => expense.expense_date.slice(0, 7) === monthKey).reduce((sum, expense) => sum + Number(expense.amount_cents || 0), 0);
    const activeOrderIds = new Set(orders.filter((order) => order.status !== "cancelled").map((order) => order.id));
    const approvedValue = quotes.filter((quote) => quote.status === "approved" && activeOrderIds.has(quote.request_id)).reduce((sum, quote) => sum + Number(quote.total_cents || 0), 0);
    const outstanding = orders.reduce((sum, order) => {
      if (order.status === "cancelled") return sum;
      const quote = quoteByRequest.get(order.id);
      if (!quote || quote.status !== "approved") return sum;
      return sum + Math.max(0, Number(quote.total_cents || 0) - Number(order.amount_paid_cents || 0));
    }, 0);
    const fundingIn = activeFunding.filter((entry) => fundingDirection(entry.entry_type) === "in").reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
    const operatingNet = salesRevenueAll - stripeFeesAll - expensesAll;
    const approvedQuotes = quotes.filter((quote) => quote.status === "approved" && activeOrderIds.has(quote.request_id));
    const approvedEstimatedCost = approvedQuotes.reduce((sum, quote) => sum + Number(quote.internal_total_cost_cents || 0), 0);
    const approvedEstimatedProfit = approvedQuotes.reduce((sum, quote) => sum + Number(quote.estimated_profit_cents || 0), 0);
    const approvedLaborHours = approvedQuotes.reduce((sum, quote) => sum + Number(quote.labor_hours || 0), 0);
    const approvedCostBreakdown = approvedQuotes.reduce((sum, quote) => ({
      supplies: sum.supplies + Number(quote.internal_supply_cost_cents || 0) + Number(quote.internal_print_cost_cents || 0) + Number(quote.internal_packaging_cost_cents || 0),
      labor: sum.labor + Number(quote.labor_cost_cents || 0),
      shipping: sum.shipping + Number(quote.internal_shipping_cost_cents || 0),
      fees: sum.fees + Number(quote.internal_payment_fee_cents || 0),
      other: sum.other + Number(quote.internal_other_cost_cents || 0),
    }), { supplies: 0, labor: 0, shipping: 0, fees: 0, other: 0 });
    const approvedNonLaborCost = Math.max(0, approvedEstimatedCost - approvedCostBreakdown.labor);
    return { receivedAll, receivedMonth, salesTaxAll, salesTaxMonth, salesRevenueAll, salesRevenueMonth, stripeFeesAll, stripeFeesMonth, expensesAll, expensesMonth, approvedValue, outstanding, netMonth: salesRevenueMonth - stripeFeesMonth - expensesMonth, fundingIn, operatingNet, approvedEstimatedCost, approvedEstimatedProfit, approvedCostBreakdown, approvedLaborHours, approvedNonLaborCost };
  }, [paidPayments, activeExpenses, quotes, orders, quoteByRequest, monthKey, activeFunding]);

  const weeklySalesGoal = Number(businessSettings?.weekly_sales_goal_cents ?? 750000);
  const weeklyProfitGoal = Number(businessSettings?.weekly_profit_goal_cents ?? 300000);
  const weeklyOwnerGoal = Number(businessSettings?.weekly_owner_goal_cents ?? 270000);
  const weeklyReserveGoal = Number(businessSettings?.weekly_reserve_goal_cents ?? 30000);
  const incomeTaxReserveRate = Math.max(0, Number(businessSettings?.income_tax_reserve_basis_points ?? 3000)) / 10000;

  const goalProgress = useMemo(() => {
    const periodPayments = paidPayments.filter((payment) => {
      const key = dateKeyForNewYork(payment.paid_at || payment.created_at);
      if (goalPeriod === "week") return key >= easternWeek.startKey && key <= easternWeek.endKey;
      if (goalPeriod === "month") return key.startsWith(monthKey);
      return key.startsWith(currentTaxYear);
    });
    const sales = periodPayments.reduce((sum, payment) => sum + paymentSalesRevenue(payment), 0);
    const paymentByRequest = new Map<string, number>();
    for (const payment of periodPayments) paymentByRequest.set(payment.request_id, (paymentByRequest.get(payment.request_id) || 0) + Number(payment.amount_cents || 0));
    const profit = Array.from(paymentByRequest.entries()).reduce((sum, [requestId, paidInPeriod]) => {
      const quote = quoteByRequest.get(requestId);
      if (!quote || Number(quote.total_cents || 0) <= 0) return sum;
      const recognizedShare = Math.min(1, paidInPeriod / Number(quote.total_cents || 1));
      return sum + Math.round(Math.max(0, Number(quote.estimated_profit_cents || 0)) * recognizedShare);
    }, 0);
    const multiplier = goalPeriod === "week" ? 1 : goalPeriod === "month" ? 52 / 12 : 52;
    const periodName = goalPeriod === "week" ? "Weekly" : goalPeriod === "month" ? "Monthly" : "Yearly";
    const eyebrow = goalPeriod === "week" ? "Monday–Sunday · Eastern Time" : goalPeriod === "month" ? "Calendar month · Eastern Time" : "Calendar year · Eastern Time";
    const label = goalPeriod === "week" ? easternWeek.label : goalPeriod === "month" ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" }).format(new Date()) : currentTaxYear;
    return { sales, profit, periodName, eyebrow, label, salesGoal: Math.round(weeklySalesGoal * multiplier), profitGoal: Math.round(weeklyProfitGoal * multiplier), ownerGoal: Math.round(weeklyOwnerGoal * multiplier), reserveGoal: Math.round(weeklyReserveGoal * multiplier) };
  }, [paidPayments, quoteByRequest, easternWeek.startKey, easternWeek.endKey, easternWeek.label, monthKey, currentTaxYear, goalPeriod, weeklySalesGoal, weeklyProfitGoal, weeklyOwnerGoal, weeklyReserveGoal]);

  const goalProductionEstimate = useMemo(() => {
    const salesRemaining = Math.max(0, goalProgress.salesGoal - goalProgress.sales);
    const profitRemaining = Math.max(0, goalProgress.profitGoal - goalProgress.profit);
    const targetProfitRate = goalProgress.salesGoal > 0 ? goalProgress.profitGoal / goalProgress.salesGoal : 0.4;
    const piecesPerOrder = 10;
    const scenarios = [2500, 3500, 5000].map((averagePriceCents) => {
      const estimatedProfitPerPiece = Math.max(1, Math.round(averagePriceCents * targetProfitRate));
      const piecesForSales = Math.ceil(salesRemaining / averagePriceCents);
      const piecesForProfit = Math.ceil(profitRemaining / estimatedProfitPerPiece);
      const piecesNeeded = Math.max(piecesForSales, piecesForProfit);
      return {
        averagePriceCents,
        estimatedProfitPerPiece,
        piecesNeeded,
        ordersNeeded: Math.ceil(piecesNeeded / piecesPerOrder),
        projectedSalesCents: piecesNeeded * averagePriceCents,
      };
    });
    return { salesRemaining, profitRemaining, targetProfitRate, piecesPerOrder, scenarios };
  }, [goalProgress]);

  const ownerEarnings = useMemo(() => {
    const todayKey = dateKeyForNewYork(new Date());
    const startKey = earningsPeriod === "week" ? easternWeek.startKey : earningsPeriod === "14days" ? shiftDateKey(todayKey, -13) : earningsPeriod === "month" ? `${monthKey}-01` : earningsPeriod === "year" ? `${currentTaxYear}-01-01` : null;
    const periodPayments = paidPayments.filter((payment) => !startKey || dateKeyForNewYork(payment.paid_at || payment.created_at) >= startKey);
    const recognizedProfit = (payments: FinancialPaymentRow[]) => {
      const paidByRequest = new Map<string, number>();
      for (const payment of payments) paidByRequest.set(payment.request_id, (paidByRequest.get(payment.request_id) || 0) + Number(payment.amount_cents || 0));
      let profit = 0;
      let incomplete = 0;
      for (const [requestId, amountPaid] of paidByRequest) {
        const quote = quoteByRequest.get(requestId);
        if (!quote || Number(quote.total_cents || 0) <= 0 || quote.estimated_profit_cents == null) { incomplete += 1; continue; }
        const recognizedShare = Math.min(1, amountPaid / Number(quote.total_cents));
        profit += Math.round(Math.max(0, Number(quote.estimated_profit_cents)) * recognizedShare);
      }
      return { profit, incomplete };
    };
    const periodProfit = recognizedProfit(periodPayments);
    const allTimeProfit = recognizedProfit(paidPayments);
    const estimatedProfit = periodProfit.profit;
    const incompleteOrders = periodProfit.incomplete;
    const combinedTaxReserve = Math.ceil(estimatedProfit * incomeTaxReserveRate);
    const afterTaxReserve = Math.max(0, estimatedProfit - combinedTaxReserve);
    const salGross = Math.ceil(estimatedProfit / 2);
    const mattGross = Math.max(0, estimatedProfit - salGross);
    const salAfterReserve = Math.ceil(afterTaxReserve / 2);
    const mattAfterReserve = Math.max(0, afterTaxReserve - salAfterReserve);
    const missingStripeFees = periodPayments.filter((payment) => payment.payment_method === "stripe" && payment.stripe_fee_cents == null).length;
    const periodDraws = activeFunding.filter((entry) => entry.entry_type === "owner_draw" && (!startKey || entry.entry_date >= startKey));
    const salWithdrawn = periodDraws.filter((entry) => ownerDrawRecipient(entry.party_name) === "sal").reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
    const mattWithdrawn = periodDraws.filter((entry) => ownerDrawRecipient(entry.party_name) === "matt").reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
    const unassignedWithdrawn = periodDraws.filter((entry) => ownerDrawRecipient(entry.party_name) === "unassigned").reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
    const allTimeDraws = activeFunding.filter((entry) => entry.entry_type === "owner_draw");
    const salWithdrawnAllTime = allTimeDraws.filter((entry) => ownerDrawRecipient(entry.party_name) === "sal").reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
    const mattWithdrawnAllTime = allTimeDraws.filter((entry) => ownerDrawRecipient(entry.party_name) === "matt").reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
    const allTimeReserve = Math.ceil(allTimeProfit.profit * incomeTaxReserveRate);
    const allTimeAfterReserve = Math.max(0, allTimeProfit.profit - allTimeReserve);
    const salAllTimeAfterReserve = Math.ceil(allTimeAfterReserve / 2);
    const mattAllTimeAfterReserve = Math.max(0, allTimeAfterReserve - salAllTimeAfterReserve);
    const salRunningBalance = salAllTimeAfterReserve - salWithdrawnAllTime;
    const mattRunningBalance = mattAllTimeAfterReserve - mattWithdrawnAllTime;
    const labels: Record<EarningsPeriod, string> = { week: easternWeek.label, "14days": "Last 14 days", month: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" }).format(new Date()), year: currentTaxYear, all: "All recorded time" };
    return { estimatedProfit, combinedTaxReserve, afterTaxReserve, salGross, mattGross, salAfterReserve, mattAfterReserve, salWithdrawn, mattWithdrawn, salPeriodNet: salAfterReserve - salWithdrawn, mattPeriodNet: mattAfterReserve - mattWithdrawn, salWithdrawnAllTime, mattWithdrawnAllTime, salRunningBalance, mattRunningBalance, unassignedWithdrawn, incompleteOrders, missingStripeFees, label: labels[earningsPeriod], paymentCount: periodPayments.length };
  }, [earningsPeriod, easternWeek.startKey, easternWeek.label, monthKey, currentTaxYear, paidPayments, quoteByRequest, incomeTaxReserveRate, activeFunding]);

  const taxReserveEstimate = useMemo(() => {
    const yearPayments = paidPayments.filter((payment) => dateKeyForNewYork(payment.paid_at || payment.created_at).startsWith(currentTaxYear));
    const yearExpenses = activeExpenses.filter((expense) => expense.expense_date.startsWith(currentTaxYear));
    const grossCollected = yearPayments.reduce((sum, payment) => sum + Number(payment.amount_cents || 0), 0);
    const salesTaxCollected = yearPayments.reduce((sum, payment) => sum + paymentTaxCollected(payment), 0);
    const salesRevenue = yearPayments.reduce((sum, payment) => sum + paymentSalesRevenue(payment), 0);
    const stripeFees = yearPayments.reduce((sum, payment) => sum + paymentStripeFee(payment), 0);
    const recordedExpenses = yearExpenses.reduce((sum, expense) => sum + Number(expense.amount_cents || 0), 0);
    const outsideGifts = activeFunding
      .filter((entry) => entry.entry_type === "gift_received" && entry.entry_date.startsWith(currentTaxYear))
      .reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
    const estimatedTaxableProfitBeforeGifts = Math.max(0, salesRevenue - stripeFees - recordedExpenses);
    // Direct gifts to a for-profit LLC are fact-specific for income-tax purposes.
    // Reserve against the full amount until the final return treatment is documented.
    const potentialTaxableIncome = estimatedTaxableProfitBeforeGifts + outsideGifts;
    const giftTaxReserve = Math.ceil(outsideGifts * incomeTaxReserveRate);
    const combinedOwnerReserve = Math.ceil(potentialTaxableIncome * incomeTaxReserveRate);
    const salReserve = Math.ceil(combinedOwnerReserve / 2);
    const mattReserve = Math.max(0, combinedOwnerReserve - salReserve);
    const missingStripeFees = yearPayments.filter((payment) => payment.payment_method === "stripe" && payment.stripe_fee_cents == null).length;
    return { grossCollected, salesTaxCollected, salesRevenue, stripeFees, recordedExpenses, outsideGifts, estimatedTaxableProfitBeforeGifts, potentialTaxableIncome, giftTaxReserve, combinedOwnerReserve, salReserve, mattReserve, missingStripeFees };
  }, [paidPayments, activeExpenses, activeFunding, currentTaxYear, incomeTaxReserveRate]);

  const monthlyTrend = useMemo(() => sixMonthKeys().map(({ key, label }) => {
    const monthPayments = paidPayments.filter((payment) => monthKeyForNewYork(payment.paid_at || payment.created_at) === key);
    const revenue = monthPayments.reduce((sum, payment) => sum + paymentSalesRevenue(payment), 0);
    const monthExpenses = activeExpenses.filter((expense) => expense.expense_date.slice(0, 7) === key).reduce((sum, expense) => sum + expense.amount_cents, 0) + monthPayments.reduce((sum, payment) => sum + paymentStripeFee(payment), 0);
    return { label, revenue, expenses: monthExpenses, net: revenue - monthExpenses };
  }), [paidPayments, activeExpenses]);

  const expensesByCategory = useMemo(() => Object.entries(EXPENSE_CATEGORY_LABELS).map(([category, label]) => ({
    category,
    label,
    amount: activeExpenses.filter((expense) => expense.category === category).reduce((sum, expense) => sum + expense.amount_cents, 0),
  })).filter((row) => row.amount > 0).sort((a, b) => b.amount - a.amount), [activeExpenses]);

  const maxCategoryExpense = Math.max(1, ...expensesByCategory.map((row) => row.amount));

  const fundingByParty = useMemo(() => {
    const map = new Map<string, { name: string; contributed: number; draws: number; gifts: number; loans: number; loanRepaid: number; reimbursementsDue: number; reimbursementsPaid: number; equity: number }>();
    for (const entry of activeFunding) {
      const key = entry.party_name.trim().toLowerCase();
      const row = map.get(key) || { name: entry.party_name, contributed: 0, draws: 0, gifts: 0, loans: 0, loanRepaid: 0, reimbursementsDue: 0, reimbursementsPaid: 0, equity: 0 };
      if (entry.entry_type === "owner_contribution") row.contributed += entry.amount_cents;
      if (entry.entry_type === "owner_draw") row.draws += entry.amount_cents;
      if (entry.entry_type === "gift_received") row.gifts += entry.amount_cents;
      if (entry.entry_type === "loan_received") row.loans += entry.amount_cents;
      if (entry.entry_type === "loan_repayment") row.loanRepaid += entry.amount_cents;
      if (entry.entry_type === "reimbursement_due") row.reimbursementsDue += entry.amount_cents;
      if (entry.entry_type === "reimbursement_paid") row.reimbursementsPaid += entry.amount_cents;
      if (entry.entry_type === "equity_investment") row.equity += entry.amount_cents;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [activeFunding]);

  const goalTotals = useMemo(() => {
    const openGoals = activeGoals.filter((goal) => !["completed", "cancelled"].includes(goal.status));
    const target = openGoals.reduce((sum, goal) => sum + goal.target_amount_cents, 0);
    const saved = openGoals.reduce((sum, goal) => sum + Math.max(0, goalSaved(goal)), 0);
    return { open: openGoals.length, target, saved, remaining: Math.max(0, target - saved) };
  }, [activeGoals]);

  const readiness = useMemo(() => {
    const missingReceipts = activeExpenses.filter((expense) => !(expense.receipts || []).length).length;
    const unclassifiedFunding = activeFunding.filter((entry) => entry.entry_type === "needs_classification").length;
    const undocumentedLoans = activeFunding.filter((entry) => ["loan_received", "equity_investment"].includes(entry.entry_type) && !(entry.documents || []).length).length;
    const undocumentedGifts = activeFunding.filter((entry) => entry.entry_type === "gift_received" && !(entry.documents || []).length).length;
    const missingPaymentReceipts = paidPayments.filter((payment) => !payment.receipt_number).length;
    const missingStripeSettlements = paidPayments.filter((payment) => payment.payment_method === "stripe" && payment.stripe_fee_cents == null).length;
    const checks = [
      { label: "Customer payments have receipt records", ok: missingPaymentReceipts === 0, detail: missingPaymentReceipts ? `${missingPaymentReceipts} payment(s) need receipt IDs` : "Payment records are linked to receipts" },
      { label: "Stripe fees are reconciled", ok: missingStripeSettlements === 0, detail: missingStripeSettlements ? `${missingStripeSettlements} paid Stripe transaction(s) need settlement details synced` : "Actual Stripe fees and net deposits are saved" },
      { label: "Expense receipts are attached", ok: missingReceipts === 0, detail: missingReceipts ? `${missingReceipts} active expense(s) do not have a receipt attached` : "Every active expense has supporting files" },
      { label: "Funding is classified", ok: unclassifiedFunding === 0, detail: unclassifiedFunding ? `${unclassifiedFunding} funding entry/entries still need classification` : "No funding entries are waiting for classification" },
      { label: "Outside gifts have gift letters", ok: undocumentedGifts === 0, detail: undocumentedGifts ? `${undocumentedGifts} gift entr${undocumentedGifts === 1 ? "y needs" : "ies need"} a signed gift letter or supporting document` : "Every outside gift has supporting documentation" },
      { label: "Loans / equity have documents", ok: undocumentedLoans === 0, detail: undocumentedLoans ? `${undocumentedLoans} loan/equity entry/entries have no supporting document` : "Document-sensitive funding has attachments" },
      { label: "Accounting export is available", ok: true, detail: "QuickBooks-friendly CSV can be generated anytime" },
    ];
    const passed = checks.filter((check) => check.ok).length;
    return { checks, score: Math.round((passed / checks.length) * 100), missingReceipts, unclassifiedFunding, undocumentedLoans, undocumentedGifts, missingStripeSettlements };
  }, [activeExpenses, activeFunding, paidPayments]);

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
    setFundingType("gift_received");
    setQuickForm(null);
    router.refresh();
  }

  async function addGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingGoal(true);
    setFinanceError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const amount = Number(form.get("targetAmount") || 0);
    form.set("targetAmountCents", String(Math.round(amount * 100)));
    const response = await fetch("/api/admin/goals", { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    setSavingGoal(false);
    if (!response.ok) { setFinanceError(data.error || "Could not save this business goal."); return; }
    formElement.reset();
    setQuickForm(null);
    setView("goals");
    router.refresh();
  }

  async function submitGoalFunding(event: FormEvent<HTMLFormElement>, goalId: string, direction: "allocate" | "withdraw") {
    event.preventDefault();
    setGoalFundingSaving(true);
    setFinanceError("");
    const form = new FormData(event.currentTarget);
    const amountCents = Math.round(Number(form.get("amount") || 0) * 100);
    const response = await fetch("/api/admin/goals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goalId, id: goalId, action: direction, amountCents, fundingSource: form.get("fundingSource"), note: form.get("note") }),
    });
    const data = await response.json().catch(() => ({}));
    setGoalFundingSaving(false);
    if (!response.ok) { setFinanceError(data.error || "Could not update goal funding."); return; }
    setGoalFundingAction(null);
    router.refresh();
  }

  async function updateGoalStatus(id: string, status: BusinessGoalStatus) {
    setGoalStatusSaving(id);
    setFinanceError("");
    const response = await fetch("/api/admin/goals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "status", status }) });
    const data = await response.json().catch(() => ({}));
    setGoalStatusSaving(null);
    if (!response.ok) { setFinanceError(data.error || "Could not update goal status."); return; }
    router.refresh();
  }

  async function editGoal(event: FormEvent<HTMLFormElement>, goal: BusinessGoalRow) {
    event.preventDefault();
    setGoalEditSaving(true); setFinanceError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/goals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: goal.id,
        action: "edit",
        name: form.get("name"),
        description: form.get("description"),
        targetAmountCents: Math.round(Number(form.get("targetAmount") || 0) * 100),
        priority: form.get("priority"),
        status: form.get("status"),
        targetDate: form.get("targetDate"),
        fundingSource: form.get("fundingSource"),
        note: form.get("note"),
      }),
    });
    const data = await response.json().catch(() => ({}));
    setGoalEditSaving(false);
    if (!response.ok) { setFinanceError(data.error || "Could not save the goal changes."); return; }
    setEditingGoalId(null); router.refresh();
  }

  async function voidGoal(id: string) {
    const reason = window.prompt("Why are you voiding this goal? The goal and its history will remain in the audit trail.", "Entered by mistake");
    if (reason === null) return;
    setVoidingGoalId(id);
    setFinanceError("");
    const response = await fetch("/api/admin/goals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "void", reason }) });
    const data = await response.json().catch(() => ({}));
    setVoidingGoalId(null);
    if (!response.ok) { setFinanceError(data.error || "Could not void this goal."); return; }
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
    if (!window.confirm("Remove this receipt from the expense? The audit trail will still record that it was removed.")) return;
    setDeletingReceiptId(receiptId);
    setFinanceError("");
    const response = await fetch(`/api/admin/expenses/${expenseId}/receipts`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receiptId }) });
    const data = await response.json().catch(() => ({}));
    setDeletingReceiptId(null);
    if (!response.ok) { setFinanceError(data.error || "Could not remove the receipt."); return; }
    router.refresh();
  }

  async function voidExpense(id: string) {
    const reason = window.prompt("Why are you voiding this expense? It will stop counting in totals, but the original entry and receipts will remain in the audit history.", "Entered by mistake");
    if (reason === null) return;
    setVoidingExpenseId(id);
    setFinanceError("");
    const response = await fetch("/api/admin/expenses", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reason }) });
    const data = await response.json().catch(() => ({}));
    setVoidingExpenseId(null);
    if (!response.ok) { setFinanceError(data.error || "Could not void this expense."); return; }
    router.refresh();
  }

  function exportPayments() {
    downloadCsv("moore-made-payments.csv", [["Receipt", "Date", "Order", "Customer", "Product", "Method", "Gross collected", "Sales tax", "Sales revenue", "Stripe fee", "Net settlement", "Reference"], ...paidPayments.map((payment) => { const order = orderById.get(payment.request_id); const tax = paymentTaxCollected(payment); const fee = paymentStripeFee(payment); return [receiptLabel(payment.receipt_number, payment.receipt_order_number || order?.request_number, payment.receipt_payment_sequence), payment.paid_at || payment.created_at, order ? formatRequestNumber(order.request_number) : "", order?.customer_name || "", order?.product || "", paymentMethodLabel(payment.payment_method), (payment.amount_cents / 100).toFixed(2), (tax / 100).toFixed(2), (paymentSalesRevenue(payment) / 100).toFixed(2), payment.stripe_fee_cents == null ? "" : (fee / 100).toFixed(2), payment.stripe_net_cents == null ? "" : (Number(payment.stripe_net_cents) / 100).toFixed(2), payment.manual_reference || ""]; })]);
  }

  function exportExpenses() {
    downloadCsv("moore-made-expenses.csv", [["Date", "Vendor", "Category", "Description", "Amount", "Payment method", "Receipt files", "Note", "Status", "Void reason"], ...expenses.map((expense) => [expense.expense_date, expense.vendor, EXPENSE_CATEGORY_LABELS[expense.category], expense.description || "", (expense.amount_cents / 100).toFixed(2), expense.payment_method || "", (expense.receipts || []).map((receipt) => receipt.original_filename).join("; "), expense.note || "", expense.voided_at ? "VOID" : "Active", expense.void_reason || ""])]);
  }

  function exportFunding() {
    downloadCsv("moore-made-funding-ledger.csv", [["Date", "Person / source", "Relationship", "Type", "Amount", "Ownership %", "Method", "Reference", "Documents", "Note", "Status"], ...funding.map((entry) => [entry.entry_date, entry.party_name, FUNDING_PARTY_KIND_LABELS[entry.party_kind], FUNDING_ENTRY_TYPE_LABELS[entry.entry_type], (entry.amount_cents / 100).toFixed(2), entry.ownership_percent ?? "", entry.payment_method || "", entry.reference || "", (entry.documents || []).map((document) => document.original_filename).join("; "), entry.note || "", entry.voided_at ? `VOID — ${entry.void_reason || ""}` : "Active"])]);
  }

  function exportGoals() {
    downloadCsv("moore-made-business-goals.csv", [["Goal", "Priority", "Status", "Target", "Saved", "Remaining", "Target date", "Funding source", "Description", "Note"], ...sortedActiveGoals.map((goal) => { const saved = Math.max(0, goalSaved(goal)); return [goal.name, BUSINESS_GOAL_PRIORITY_LABELS[goal.priority], BUSINESS_GOAL_STATUS_LABELS[goal.status], (goal.target_amount_cents / 100).toFixed(2), (saved / 100).toFixed(2), (Math.max(0, goal.target_amount_cents - saved) / 100).toFixed(2), goal.target_date || "", goal.funding_source || "", goal.description || "", goal.note || ""]; })]);
  }

  function exportAudit() {
    downloadCsv("moore-made-finance-audit.csv", [["Time", "Record", "Action", "Actor", "Summary", "Entity id"], ...financeAudit.map((entry) => [entry.occurred_at, auditEntityLabel(entry.entity_type), auditActionLabel(entry.action), entry.actor_user_id ? adminById.get(entry.actor_user_id) || entry.actor_user_id : "System / automated", auditSummary(entry), entry.entity_id || ""])]);
  }

  function exportAccounting() {
    const rows: Array<Array<unknown>> = [["Date", "Record type", "Name", "Category", "Memo", "Money in", "Money out", "Method", "Reference"]];
    for (const payment of paidPayments) {
      const order = orderById.get(payment.request_id);
      const date = (payment.paid_at || payment.created_at).slice(0, 10);
      const reference = payment.manual_reference || receiptLabel(payment.receipt_number, payment.receipt_order_number || order?.request_number, payment.receipt_payment_sequence);
      const memo = order ? `${formatRequestNumber(order.request_number)} · ${order.product}` : "Customer payment";
      const tax = paymentTaxCollected(payment);
      const fee = paymentStripeFee(payment);
      rows.push([date, "Customer payment", order?.customer_name || "Customer", "Sales income", memo, (paymentSalesRevenue(payment) / 100).toFixed(2), "", paymentMethodLabel(payment.payment_method), reference]);
      if (tax > 0) rows.push([date, "Sales tax collected", order?.customer_name || "Customer", "Sales tax payable", memo, (tax / 100).toFixed(2), "", paymentMethodLabel(payment.payment_method), reference]);
      if (fee > 0) rows.push([date, "Stripe fee", "Stripe", "Processing / bank fees", memo, "", (fee / 100).toFixed(2), "Stripe", reference]);
    }
    for (const expense of activeExpenses) rows.push([expense.expense_date, "Business expense", expense.vendor, EXPENSE_CATEGORY_LABELS[expense.category], expense.description || expense.note || "", "", (expense.amount_cents / 100).toFixed(2), expense.payment_method || "", ""]);
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
        <div><div className="eyebrow">Business & financials</div><h2>Moore Made financial command center.</h2><p>See how the business is doing, fund the next goal, keep records audit-safe, and stay organized for QuickBooks and tax time.</p></div>
        <div className="financeExportActions"><button type="button" className="btn secondary" onClick={exportAccounting}>QuickBooks / accounting CSV</button><button type="button" className="textButton" onClick={() => { setView("tax"); setQuickForm(null); }}>Tax & audit</button></div>
      </div>

      <div className="financeViewTabs" role="tablist" aria-label="Financial workspace">
        <button type="button" className={view === "overview" ? "active" : ""} onClick={() => { setView("overview"); setQuickForm(null); }}>Overview</button>
        <button type="button" className={view === "goals" ? "active" : ""} onClick={() => { setView("goals"); setQuickForm(null); }}>Goals {goalTotals.open ? <span>{goalTotals.open}</span> : null}</button>
        <button type="button" className={view === "transactions" ? "active" : ""} onClick={() => { setView("transactions"); setQuickForm(null); }}>Transactions</button>
        <button type="button" className={view === "funding" ? "active" : ""} onClick={() => { setView("funding"); setQuickForm(null); }}>Funding</button>
        <button type="button" className={view === "discounts" ? "active" : ""} onClick={() => { setView("discounts"); setQuickForm(null); }}>Discounts</button>
        <button type="button" className={view === "tax" ? "active" : ""} onClick={() => { setView("tax"); setQuickForm(null); }}>Tax & audit</button>
      </div>

      <div className="financeQuickActions" aria-label="Financial quick actions">
        <button className={quickForm === "expense" ? "active" : ""} type="button" onClick={() => quickForm === "expense" ? setQuickForm(null) : openQuickForm("expense", "transactions")}><span>−</span><strong>Add expense</strong><small>Purchase, fee, supplies</small></button>
        <button className={quickForm === "funding" ? "active" : ""} type="button" disabled={!fundingReady} onClick={() => quickForm === "funding" ? setQuickForm(null) : openQuickForm("funding", "funding")}><span>↔</span><strong>Money in / owner draw</strong><small>Capital, gift, loan, owner pay</small></button>
        <button className={quickForm === "goal" ? "active" : ""} type="button" disabled={!goalsReady} onClick={() => quickForm === "goal" ? setQuickForm(null) : openQuickForm("goal", "goals")}><span>◎</span><strong>New goal</strong><small>Equipment, repair, growth</small></button>
        <button type="button" onClick={exportAccounting}><span>⇩</span><strong>Export books</strong><small>Accounting-friendly CSV</small></button>
      </div>

      {!goalsReady || !auditReady ? <div className="requestNote"><strong>Finish the Finance Command Center database update.</strong> Run <code>supabase/moore_made_phase6_16_finance_command_center.sql</code> once in Supabase to enable goals, expense voiding, and the full audit trail.</div> : null}
      {!fundingReady ? <div className="requestNote"><strong>Funding ledger needs its earlier database update.</strong> Run <code>supabase/moore_made_phase6_12_funding_ledger.sql</code>.</div> : null}
      {financeError ? <div className="formError financeTableError">{financeError}</div> : null}

      {quickForm === "expense" ? <section ref={quickFormRef} className="card financeQuickFormCard financeQuickFormCompact">
        <div className="financePanelHead"><div><div className="eyebrow">Add expense</div><h3>Record business spending.</h3><p>Keep the entry short and attach the receipt now so it is tax-ready later.</p></div><button type="button" className="textButton" onClick={() => setQuickForm(null)}>Close</button></div>
        <form onSubmit={addExpense}>
          <div className="financeFormThree"><label className="field"><span>Date</span><input type="date" name="expenseDate" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label className="field"><span>Amount</span><input type="number" name="amount" min="0.01" step="0.01" placeholder="0.00" required /></label><label className="field"><span>Category</span><select name="category" defaultValue="materials">{Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
          <div className="twoCol"><label className="field"><span>Vendor / payee</span><input name="vendor" maxLength={160} required placeholder="Shirt supplier, USPS, software…" /></label><label className="field"><span>Payment method</span><input name="paymentMethod" maxLength={100} placeholder="Business card, cash, etc." /></label></div>
          <div className="twoCol"><label className="field"><span>Description</span><input name="description" maxLength={500} placeholder="What was purchased?" /></label><label className="field"><span>Internal note</span><input name="note" maxLength={1000} placeholder="Optional" /></label></div>
          <div className="financeFormFooter"><label className="field financeReceiptUploadField"><span>Receipt files <small>Optional</small></span><input type="file" name="receipts" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif" /><small className="fieldHelp">Up to 10 photos or PDFs, 20 MB each.</small></label><button className="btn financeSaveButton" type="submit" disabled={savingExpense}>{savingExpense ? "Saving…" : "Save expense"}</button></div>
        </form>
      </section> : null}

      {quickForm === "funding" && fundingReady ? <section ref={quickFormRef} className="card financeQuickFormCard financeQuickFormCompact">
        <div className="financePanelHead"><div><div className="eyebrow">Money moving between Moore Made and people</div><h3>{fundingType === "owner_draw" ? "Record money paid to an owner." : "Record funding received or repaid."}</h3><p>Owner draws stay separate from business expenses so profit and tax planning remain accurate.</p></div><button type="button" className="textButton" onClick={() => setQuickForm(null)}>Close</button></div>
        <form onSubmit={addFunding}>
          <div className="financeFormThree"><label className="field"><span>Date</span><input type="date" name="entryDate" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label className="field"><span>Amount</span><input type="number" name="amount" min="0.01" step="0.01" placeholder="0.00" required /></label><label className="field"><span>Relationship</span><select name="partyKind" defaultValue="member">{fundingType === "owner_draw" ? <option value="member">Owner / member</option> : Object.entries(FUNDING_PARTY_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          <div className="twoCol"><label className="field"><span>{fundingType === "owner_draw" ? "Owner receiving the money" : "Person / funding source"}</span>{fundingType === "owner_draw" ? <select name="partyName" defaultValue="Salvatore Moore" required><option value="Salvatore Moore">Salvatore Moore</option><option value="Matthew Moore">Matthew Moore</option></select> : <input name="partyName" required placeholder="Salvatore, Matthew, Mom, Aunt Jane…" />}</label><label className="field"><span>Money type</span><select name="entryType" value={fundingType} onChange={(event) => setFundingType(event.target.value as FundingEntryType)}>{Object.entries(FUNDING_ENTRY_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          {fundingType === "equity_investment" ? <div className="fundingLegalWarning"><strong>Equity changes ownership.</strong><span>Only use this after the ownership deal and legal paperwork are completed. Recording it here does not itself make someone an owner.</span><label className="field"><span>Ownership % documented</span><input name="ownershipPercent" type="number" min="0" max="100" step="0.01" placeholder="Example: 5" required /></label></div> : null}
          {fundingType === "gift_received" ? <div className="fundingLegalWarning"><strong>Voluntary gift directly to Moore Made LLC.</strong><span>No repayment, ownership, profit share, products, services, discounts, control, or charitable tax deduction may be promised. The Tax page will conservatively reserve against the full gift until final tax treatment is documented.</span><label className="financeConfirmCheck"><input name="giftAcknowledged" type="checkbox" value="yes" required /><span>I confirm this is an unconditional gift and nothing was promised in return.</span></label></div> : null}
          {fundingType === "owner_draw" ? <div className="ownerDrawNotice"><strong>Owner draw—not payroll or a business expense.</strong><span>Move the money through Huntington first, then record the exact date, amount, owner, method, and bank/ATM reference here. The draw reduces that owner’s running available balance but does not reduce Moore Made’s business profit or tax estimate.</span></div> : null}
          {fundingType === "needs_classification" ? <div className="requestNote"><strong>Needs classification.</strong> Record the movement now, then classify it before tax filing.</div> : null}
          <div className="twoCol"><label className="field"><span>Payment method</span><input name="paymentMethod" placeholder="Transfer, check, cash…" /></label><label className="field"><span>Reference</span><input name="reference" placeholder="Transfer memo, check #, agreement #…" /></label></div>
          <div className="twoCol financeFundingDetails"><label className="field"><span>Note</span><textarea name="note" placeholder={fundingType === "owner_draw" ? "Example: Owner draw transferred to personal checking" : "What was this money for? What did everyone agree to?"} /></label><label className="field"><span>{fundingType === "owner_draw" ? "Bank / ATM record" : "Gift letter / supporting documents"} <small>Recommended</small></span><input name="documents" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif" /><small className="fieldHelp">{fundingType === "owner_draw" ? "Attach the transfer confirmation, check image, or ATM receipt. Up to 5 files." : "Attach the signed gift letter, check, or transfer record. Up to 5 files."}</small></label></div>
          <div className="financeFormActions"><button className="btn financeSaveButton" type="submit" disabled={savingFunding}>{savingFunding ? "Saving…" : "Save funding entry"}</button></div>
        </form>
      </section> : null}

      {quickForm === "goal" && goalsReady ? <section ref={quickFormRef} className="card financeQuickFormCard">
        <div className="financePanelHead"><div><div className="eyebrow">New business goal</div><h3>What is Moore Made working toward next?</h3></div><button type="button" className="textButton" onClick={() => setQuickForm(null)}>Close</button></div>
        <form onSubmit={addGoal}>
          <div className="twoCol"><label className="field"><span>Goal</span><input name="name" required maxLength={160} placeholder="Repair DTF printer" /></label><label className="field"><span>Target amount</span><input type="number" name="targetAmount" min="0.01" step="0.01" required placeholder="0.00" /></label></div>
          <label className="field"><span>Why / description</span><textarea name="description" placeholder="What this unlocks for the business and what the money is expected to cover." /></label>
          <div className="threeCol"><label className="field"><span>Priority</span><select name="priority" defaultValue="high">{Object.entries(GOAL_PRIORITY_GUIDANCE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span>Status</span><select name="status" defaultValue="saving">{Object.entries(BUSINESS_GOAL_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span>Target date <small>Optional</small></span><input name="targetDate" type="date" /></label></div>
          <label className="field"><span>Planned funding source <small>Optional</small></span><input name="fundingSource" placeholder="Business profits, owner capital, family loan…" /></label>
          <label className="field"><span>Internal note <small>Optional</small></span><input name="note" placeholder="Quotes, model being considered, service estimate, etc." /></label>
          <button className="btn" type="submit" disabled={savingGoal}>{savingGoal ? "Saving…" : "Create business goal"}</button>
        </form>
      </section> : null}

      {view === "discounts" ? <AdminDiscountCodesPanel codes={discountCodes} ready={discountsReady} /> : null}

      {view === "overview" ? <>
        <section className="card weeklyGoalCard" aria-label={`${goalProgress.periodName} goals`}>
          <div className="weeklyGoalCardHead"><div><div className="eyebrow">{goalProgress.eyebrow}</div><h3>{goalProgress.periodName} Goal</h3><p>{goalProgress.label}. Sales exclude sales tax; profit recognizes the matching share of each quote’s private estimated profit.</p></div><div className="weeklyGoalHeadActions"><span className="weeklyGoalSettingsHint">Based on weekly goals · Editable in Products & Pricing</span><div className="goalPeriodTabs" aria-label="Goal period">{([['week','Weekly'],['month','Monthly'],['year','Yearly']] as Array<[GoalPeriod,string]>).map(([value,label]) => <button key={value} type="button" className={goalPeriod === value ? "isActive" : ""} aria-pressed={goalPeriod === value} onClick={() => setGoalPeriod(value)}>{label}</button>)}</div></div></div>
          <div className="weeklyGoalReferenceNumbers">
            <div><span>Sales goal</span><strong>{money(goalProgress.salesGoal)}</strong></div>
            <div><span>Business-profit goal</span><strong>{money(goalProgress.profitGoal)}</strong></div>
            <div><span>Combined owner reference</span><strong>{money(goalProgress.ownerGoal)}</strong></div>
            <div><span>Business reserve reference</span><strong>{money(goalProgress.reserveGoal)}</strong></div>
          </div>
          <div className="weeklyGoalBars">
            <WeeklyGoalBar label={`${goalProgress.periodName} sales progress`} current={goalProgress.sales} goal={goalProgress.salesGoal} tone="sales" />
            <WeeklyGoalBar label={`${goalProgress.periodName} profit progress`} current={goalProgress.profit} goal={goalProgress.profitGoal} tone="profit" />
          </div>
          <section className="goalProductionEstimator" aria-label={`${goalProgress.periodName} production estimate`}>
            <div className="goalProductionEstimatorHead"><div><span className="eyebrow">What it could take from here</span><strong>Estimated products and orders still needed</strong></div><small>Uses about {goalProductionEstimate.piecesPerOrder} products per order and the current {(goalProductionEstimate.targetProfitRate * 100).toFixed(0)}% sales-to-profit goal.</small></div>
            {goalProductionEstimate.salesRemaining === 0 && goalProductionEstimate.profitRemaining === 0 ? <div className="goalProductionReached">Goal reached for this period—everything else adds to the cushion.</div> : <>
              <div className="goalProductionRemaining"><span><small>Sales still needed</small><strong>{money(goalProductionEstimate.salesRemaining)}</strong></span><span><small>Profit still needed</small><strong>{money(goalProductionEstimate.profitRemaining)}</strong></span></div>
              <div className="goalProductionScenarios">{goalProductionEstimate.scenarios.map((scenario, index) => <article className={index === 1 ? "isBaseline" : ""} key={scenario.averagePriceCents}><div className="goalProductionScenarioPrice"><span>{index === 1 ? "Planning baseline" : "Price scenario"}</span><strong>{money(scenario.averagePriceCents)} average customer price</strong></div><div><span>Estimated profit each</span><strong>{money(scenario.estimatedProfitPerPiece)}</strong></div><div><span>Products still needed</span><strong>{scenario.piecesNeeded.toLocaleString()}</strong></div><div><span>Approx. orders</span><strong>{scenario.ordersNeeded.toLocaleString()}</strong></div><small>About {money(scenario.projectedSalesCents)} in additional sales if the mix averages this price.</small></article>)}</div>
              <p className="goalProductionDisclaimer">Planning estimate only—not a production quota. Shirts, embroidery, mugs, totes, bulk orders, discounts, fulfillment charges, and actual margins will change the number of pieces needed.</p>
            </>}
          </section>
        </section>
        <section className="card ownerEarningsCard" aria-label="Owner earnings estimate">
          <div className="ownerEarningsHead"><div><div className="eyebrow">Paid-order earnings · Eastern Time</div><h3>What Sal and Matt have earned</h3><p>Use the period buttons to compare earnings and draws. Current running balances always include all recorded activity, so earlier overdraws carry forward.</p></div><div className="ownerEarningsPeriods" aria-label="Earnings period">{([['week','This week'],['14days','Last 14 days'],['month','This month'],['year','This year'],['all','All time']] as Array<[EarningsPeriod,string]>).map(([value, label]) => <button key={value} type="button" className={earningsPeriod === value ? "isActive" : ""} onClick={() => setEarningsPeriod(value)}>{label}</button>)}</div></div>
          <div className="ownerEarningsPeriodLabel"><strong>{ownerEarnings.label}</strong><span>{ownerEarnings.paymentCount} paid payment{ownerEarnings.paymentCount === 1 ? "" : "s"}</span></div>
          <div className="ownerEarningsSummary">
            <article className="ownerEarningsTotal"><span>Estimated business profit earned</span><strong>{money(ownerEarnings.estimatedProfit)}</strong><small>Before personal tax reserves or an owner payout</small></article>
            <article><span>Sal’s estimated amount after reserve</span><strong>{money(ownerEarnings.salAfterReserve)}</strong><small>{money(ownerEarnings.salGross)} earned before the suggested tax reserve</small></article>
            <article><span>Matt’s estimated amount after reserve</span><strong>{money(ownerEarnings.mattAfterReserve)}</strong><small>{money(ownerEarnings.mattGross)} earned before the suggested tax reserve</small></article>
            <article className="ownerEarningsReserve"><span>Combined suggested tax reserve</span><strong>{money(ownerEarnings.combinedTaxReserve)}</strong><small>{(incomeTaxReserveRate * 100).toFixed(0)}% planning rate · {money(ownerEarnings.afterTaxReserve)} remains after reserve</small></article>
          </div>
          <div className="ownerDrawSummary"><div className={ownerEarnings.salRunningBalance < 0 ? "isNegative" : ""}><span>Sal’s current running balance</span><strong>{money(ownerEarnings.salRunningBalance)}</strong><small>{ownerEarnings.label}: {money(ownerEarnings.salAfterReserve)} earned · {money(ownerEarnings.salWithdrawn)} withdrawn · {money(ownerEarnings.salPeriodNet)} net</small><small>{money(ownerEarnings.salWithdrawnAllTime)} withdrawn all time</small></div><div className={ownerEarnings.mattRunningBalance < 0 ? "isNegative" : ""}><span>Matt’s current running balance</span><strong>{money(ownerEarnings.mattRunningBalance)}</strong><small>{ownerEarnings.label}: {money(ownerEarnings.mattAfterReserve)} earned · {money(ownerEarnings.mattWithdrawn)} withdrawn · {money(ownerEarnings.mattPeriodNet)} net</small><small>{money(ownerEarnings.mattWithdrawnAllTime)} withdrawn all time</small></div><button type="button" className="btn secondary" disabled={!fundingReady} onClick={openOwnerDraw}>Record owner draw</button></div>
          {(ownerEarnings.salRunningBalance < 0 || ownerEarnings.mattRunningBalance < 0) ? <div className="ownerBalanceWarning"><strong>Owner draw balance is below zero.</strong><span>{[ownerEarnings.salRunningBalance < 0 ? `Sal is ${money(Math.abs(ownerEarnings.salRunningBalance))} ahead of currently estimated after-reserve earnings` : "", ownerEarnings.mattRunningBalance < 0 ? `Matt is ${money(Math.abs(ownerEarnings.mattRunningBalance))} ahead of currently estimated after-reserve earnings` : ""].filter(Boolean).join(" · ")}. Future after-reserve earnings will reduce the negative balance until it returns to zero.</span></div> : null}
          {ownerEarnings.unassignedWithdrawn ? <div className="ownerEarningsWarning"><strong>Owner name needs review.</strong><span>{money(ownerEarnings.unassignedWithdrawn)} in owner draws could not be assigned to Sal or Matt.</span></div> : null}
          {(ownerEarnings.missingStripeFees || ownerEarnings.incompleteOrders) ? <div className="ownerEarningsWarning"><strong>Estimate needs attention.</strong><span>{[ownerEarnings.missingStripeFees ? `${ownerEarnings.missingStripeFees} Stripe fee${ownerEarnings.missingStripeFees === 1 ? " is" : "s are"} not synced` : "", ownerEarnings.incompleteOrders ? `${ownerEarnings.incompleteOrders} paid order${ownerEarnings.incompleteOrders === 1 ? " is" : "s are"} missing usable profit data` : ""].filter(Boolean).join(" · ")}.</span></div> : <div className="ownerEarningsReady">✓ All paid orders in this view have saved profit data and reconciled Stripe fees.</div>}
          <p className="ownerEarningsNote">Planning estimate only. This card does not transfer money or record an owner draw. Confirm supplier expenses, refunds, delivery costs, and payment fees before deciding how much cash the business can safely pay out.</p>
        </section>
        <section className="card financeOwnerReserveOverview" aria-label="Owner tax reserve snapshot">
          <div className="financePanelHead"><div><div className="eyebrow">Tax planning · {currentTaxYear}</div><h3>Owner reserve snapshot</h3><p>These are estimated amounts to set aside for taxes—not earnings, owner pay, or money available to spend.</p></div><button type="button" className="textButton" onClick={() => { setView("tax"); setQuickForm(null); }}>Open tax details →</button></div>
          <div className="weeklyGoalReferenceNumbers financeOwnerReserveGrid">
            <div><span>Potential taxable amount</span><strong>{money(taxReserveEstimate.potentialTaxableIncome)}</strong></div>
            <div><span>Combined tax reserve</span><strong>{money(taxReserveEstimate.combinedOwnerReserve)}</strong></div>
            <div><span>Sal’s 50% reserve share</span><strong>{money(taxReserveEstimate.salReserve)}</strong></div>
            <div><span>Matt’s 50% reserve share</span><strong>{money(taxReserveEstimate.mattReserve)}</strong></div>
          </div>
        </section>
        <section className="financeMetricSummary" aria-label="Financial summary">
          <div className="financeMetricGroup">
            <div className="financeMetricGroupHead">
              <div>
                <div className="eyebrow">This month</div>
                <h3>Money moving through Moore Made</h3>
              </div>
            </div>
            <div className="financeMetricGrid financeMetricGridCompact">
              <article className="financeMetric">
                <span className="financeMetricLabel">Sales revenue</span>
                <strong>{money(totals.salesRevenueMonth)}</strong>
                <small>{money(totals.receivedMonth)} collected minus {money(totals.salesTaxMonth)} sales tax held</small>
              </article>
              <article className="financeMetric">
                <span className="financeMetricLabel">Expenses</span>
                <strong>{money(totals.expensesMonth + totals.stripeFeesMonth)}</strong>
                <small>{money(totals.expensesMonth)} recorded expenses + {money(totals.stripeFeesMonth)} actual Stripe fees</small>
              </article>
              <article className="financeMetric financeMetricEmphasis">
                <span className="financeMetricLabel">Operating cash</span>
                <strong>{money(totals.netMonth)}</strong>
                <small>Sales revenue minus Stripe fees and recorded expenses; sales tax excluded</small>
              </article>
            </div>
          </div>

          <div className="financeMetricGroup">
            <div className="financeMetricGroupHead">
              <div>
                <div className="eyebrow">Business snapshot</div>
                <h3>What needs attention right now</h3>
              </div>
            </div>
            <div className="financeMetricGrid financeMetricGridCompact">
              <article className="financeMetric">
                <span className="financeMetricLabel">Customer balances due</span>
                <strong>{money(totals.outstanding)}</strong>
                <small>Still due on approved active orders</small>
              </article>
              <article className="financeMetric">
                <span className="financeMetricLabel">All-time operating net</span>
                <strong>{money(totals.operatingNet)}</strong>
                <small>Sales revenue minus actual Stripe fees and expenses; sales tax excluded</small>
              </article>
              <article className="financeMetric">
                <span className="financeMetricLabel">Approved order profit</span>
                <strong>{money(totals.approvedEstimatedProfit)}</strong>
                <small>Estimated profit from approved quotes using their internal job costs</small>
              </article>
              <article className="financeMetric">
                <span className="financeMetricLabel">Approved non-labor job costs</span>
                <strong>{money(totals.approvedNonLaborCost)}</strong>
                <small>{[
                  totals.approvedCostBreakdown.supplies ? `Supplies ${money(totals.approvedCostBreakdown.supplies)}` : "",
                  totals.approvedCostBreakdown.shipping ? `Shipping ${money(totals.approvedCostBreakdown.shipping)}` : "",
                  totals.approvedCostBreakdown.fees ? `Fees ${money(totals.approvedCostBreakdown.fees)}` : "",
                  totals.approvedCostBreakdown.other ? `Other ${money(totals.approvedCostBreakdown.other)}` : "",
                ].filter(Boolean).join(" · ") || "No non-labor costs saved on approved quotes"}</small>
              </article>
              <article className="financeMetric financeLaborMetric">
                <span className="financeMetricLabel">Approved labor</span>
                <strong>{totals.approvedLaborHours.toLocaleString(undefined, { maximumFractionDigits: 2 })} hr{totals.approvedLaborHours === 1 ? "" : "s"}</strong>
                <small>{money(totals.approvedCostBreakdown.labor)} internal labor cost across approved quotes</small>
              </article>
              {goalsReady ? <article className="financeMetric">
                <span className="financeMetricLabel">Goal funding remaining</span>
                <strong>{money(goalTotals.remaining)}</strong>
                <small>{goalTotals.open ? `${goalTotals.open} active business goal${goalTotals.open === 1 ? "" : "s"}` : "No active business goals yet"}</small>
              </article> : null}
            </div>
          </div>
        </section>

        <div className="financeDashboardGrid">
          <section className="card financeChartCard financeChartCardWide">
            <div className="financePanelHead"><div><div className="eyebrow">Performance</div><h3>Revenue vs. expenses</h3></div><span>Last 6 months</span></div>
            <FinanceTrendChart rows={monthlyTrend} />
          </section>
          <section className="card financeChartCard">
            <div className="financePanelHead"><div><div className="eyebrow">Spending</div><h3>Expenses by category</h3></div><strong>{money(totals.expensesAll)}</strong></div>
            {expensesByCategory.length ? <div className="financeCategoryBars">{expensesByCategory.map((row) => <div className="financeCategoryRow" key={row.category}><div><span>{row.label}</span><strong>{money(row.amount)}</strong></div><div className="financeCategoryTrack"><span style={{ width: `${Math.max(4, (row.amount / maxCategoryExpense) * 100)}%` }} /></div></div>)}</div> : <p className="muted">Expense graphs will populate as you record business spending.</p>}
          </section>
          <section className="card financeReadinessCard financeReadinessCardCompact">
            <div className="financePanelHead">
              <div><div className="eyebrow">Tax organization</div><h3>Tax readiness</h3></div>
              <div className="financeReadinessHeadActions">
                <strong className="financeReadinessScore">{readiness.score}%</strong>
                <button type="button" className="textButton" onClick={() => { setView("tax"); setQuickForm(null); }}>Tax & audit →</button>
              </div>
            </div>
            <div className="financeReadinessBar"><span style={{ width: `${readiness.score}%` }} /></div>
            <div className="financeReadinessChecks financeReadinessChecksCompact">{readiness.checks.slice(0, 4).map((check) => <div key={check.label} className={check.ok ? "ready" : "needsWork"}><span>{check.ok ? "✓" : "!"}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div></div>)}</div>
          </section>
        </div>

        {goalsReady ? <section className="card financeGoalsPreview">
          <div className="financePanelHead"><div><div className="eyebrow">What we are building toward</div><h3>Business goals</h3></div><button type="button" className="textButton" onClick={() => { setView("goals"); setQuickForm(null); }}>View all goals →</button></div>
          {sortedActiveGoals.filter((goal) => !["completed", "cancelled"].includes(goal.status)).length ? <div className="goalPreviewGrid">{sortedActiveGoals.filter((goal) => !["completed", "cancelled"].includes(goal.status)).slice(0, 3).map((goal) => {
            const saved = Math.max(0, goalSaved(goal));
            const percent = Math.min(100, Math.round((saved / goal.target_amount_cents) * 100));
            return <article key={goal.id}><div className="goalCardTop"><span className={`goalPriority priority-${goal.priority}`}>{BUSINESS_GOAL_PRIORITY_LABELS[goal.priority]}</span><span>{percent}%</span></div><strong>{goal.name}</strong><div className="goalProgress"><span style={{ width: `${percent}%` }} /></div><small>{money(saved)} of {money(goal.target_amount_cents)} · {money(Math.max(0, goal.target_amount_cents - saved))} left</small></article>;
          })}</div> : <div className="empty compactEmpty"><p>No active goals yet. Add the DTF printer repair, embroidery machine, or whatever Moore Made is working toward next.</p><button className="btn secondary" type="button" onClick={() => openQuickForm("goal", "goals")}>Create first goal</button></div>}
        </section> : null}
      </> : null}

      {view === "goals" ? <section className="financeGoalsSection">
        <div className="financeTableHead"><div><div className="eyebrow">Business planning</div><h3>Funding goals</h3><p>Keep growth money visible without mixing it with taxes, obligations, or ordinary operating cash.</p></div><div className="financeGoalSummary"><span>{goalTotals.open} open</span><strong>{money(goalTotals.remaining)} remaining</strong></div></div>
        {!goalsReady ? <div className="requestNote">Run the Finance Command Center SQL migration to enable business goals.</div> : sortedActiveGoals.length ? <div className="businessGoalGrid">{sortedActiveGoals.map((goal) => {
          const saved = Math.max(0, goalSaved(goal));
          const remaining = Math.max(0, goal.target_amount_cents - saved);
          const percent = Math.min(100, Math.round((saved / goal.target_amount_cents) * 100));
          const actionOpen = goalFundingAction?.goalId === goal.id;
          return <article className={`businessGoalCard priority-${goal.priority}`} key={goal.id}>
            <div className="goalCardTop"><span className={`goalPriority priority-${goal.priority}`}>{BUSINESS_GOAL_PRIORITY_LABELS[goal.priority]}</span><select aria-label={`Status for ${goal.name}`} value={goal.status} disabled={goalStatusSaving === goal.id} onChange={(event) => void updateGoalStatus(goal.id, event.target.value as BusinessGoalStatus)}>{Object.entries(BUSINESS_GOAL_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
            <div><h4>{goal.name}</h4>{goal.description ? <p>{goal.description}</p> : null}</div>
            <div className="goalNumbers"><div><span>Saved</span><strong>{money(saved)}</strong></div><div><span>Target</span><strong>{money(goal.target_amount_cents)}</strong></div><div><span>Remaining</span><strong>{money(remaining)}</strong></div></div>
            <div className="goalProgress goalProgressLarge"><span style={{ width: `${percent}%` }} /></div>
            <div className="goalMeta"><span>{percent}% funded</span>{goal.target_date ? <span>Target {localDate(`${goal.target_date}T12:00:00`)}</span> : null}{goal.funding_source ? <span>Plan: {goal.funding_source}</span> : null}</div>
            {goal.note ? <p className="goalNote">{goal.note}</p> : null}
            <div className="goalActions"><button className="btn secondary" type="button" onClick={() => setGoalFundingAction(actionOpen && goalFundingAction?.direction === "allocate" ? null : { goalId: goal.id, direction: "allocate" })}>+ Allocate funds</button><button className="textButton" type="button" onClick={() => setEditingGoalId(editingGoalId === goal.id ? null : goal.id)}>{editingGoalId === goal.id ? "Close editor" : "Edit goal"}</button><button className="textButton" type="button" disabled={saved <= 0} onClick={() => setGoalFundingAction(actionOpen && goalFundingAction?.direction === "withdraw" ? null : { goalId: goal.id, direction: "withdraw" })}>Move funds out</button><button className="textButton financeDeleteButton" type="button" disabled={voidingGoalId === goal.id} onClick={() => void voidGoal(goal.id)}>{voidingGoalId === goal.id ? "Voiding…" : "Void goal"}</button></div>
            {editingGoalId === goal.id ? <form className="goalFundingForm goalEditForm" onSubmit={(event) => void editGoal(event, goal)}><strong>Edit this goal</strong><div className="twoCol"><label className="field"><span>Goal name</span><input name="name" required maxLength={160} defaultValue={goal.name} /></label><label className="field"><span>Target amount</span><input type="number" name="targetAmount" min="0.01" step="0.01" required defaultValue={(goal.target_amount_cents / 100).toFixed(2)} /></label></div><label className="field"><span>Description</span><textarea name="description" maxLength={1200} defaultValue={goal.description || ""} /></label><div className="twoCol"><label className="field"><span>Priority</span><select name="priority" defaultValue={goal.priority}>{Object.entries(GOAL_PRIORITY_GUIDANCE).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="field"><span>Status</span><select name="status" defaultValue={goal.status}>{Object.entries(BUSINESS_GOAL_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div><div className="twoCol"><label className="field"><span>Target date</span><input type="date" name="targetDate" defaultValue={goal.target_date || ""} /></label><label className="field"><span>Planned funding source</span><input name="fundingSource" maxLength={250} defaultValue={goal.funding_source || ""} /></label></div><label className="field"><span>Internal note</span><textarea name="note" maxLength={1500} defaultValue={goal.note || ""} /></label><div className="goalFundingFormActions"><button className="btn" type="submit" disabled={goalEditSaving}>{goalEditSaving ? "Saving…" : "Save goal changes"}</button><button className="textButton" type="button" onClick={() => setEditingGoalId(null)}>Cancel</button></div></form> : null}
            {actionOpen ? <form className="goalFundingForm" onSubmit={(event) => submitGoalFunding(event, goal.id, goalFundingAction!.direction)}><strong>{goalFundingAction?.direction === "allocate" ? "Allocate money to this goal" : "Move money out of this goal"}</strong><div className="twoCol"><label className="field"><span>Amount</span><input type="number" name="amount" min="0.01" step="0.01" required placeholder="0.00" /></label><label className="field"><span>Source / destination</span><input name="fundingSource" placeholder="Business checking, owner capital…" /></label></div><label className="field"><span>Note</span><input name="note" placeholder="Optional reason or reference" /></label><div className="goalFundingFormActions"><button className="btn" type="submit" disabled={goalFundingSaving}>{goalFundingSaving ? "Saving…" : goalFundingAction?.direction === "allocate" ? "Allocate funds" : "Move funds"}</button><button className="textButton" type="button" onClick={() => setGoalFundingAction(null)}>Cancel</button></div></form> : null}
            {(goal.funding_entries || []).length ? <details className="goalHistory"><summary>Funding history ({goal.funding_entries!.length})</summary><div>{goal.funding_entries!.map((entry) => <p key={entry.id}><span>{localDate(`${entry.entry_date}T12:00:00`)}</span><strong>{entry.direction === "allocate" ? "+" : "−"}{money(entry.amount_cents)}</strong><small>{entry.funding_source || entry.note || "No note"}</small></p>)}</div></details> : null}
          </article>;
        })}</div> : <div className="empty"><h3>No business goals yet.</h3><p>Add repair, equipment, inventory, event, marketing, or other growth goals and fund them over time.</p><button className="btn" type="button" onClick={() => openQuickForm("goal", "goals")}>Create a goal</button></div>}
      </section> : null}

      {view === "transactions" ? <>
        <section className="financeSectionSnapshot" aria-label="Transaction summary">
          <article><span>Sales revenue</span><strong>{money(totals.salesRevenueAll)}</strong><small>{money(totals.receivedAll)} gross collected</small></article>
          <article><span>Sales tax held</span><strong>{money(totals.salesTaxAll)}</strong><small>Liability kept separate from revenue</small></article>
          <article><span>Business expenses</span><strong>{money(totals.expensesAll + totals.stripeFeesAll)}</strong><small>Includes {money(totals.stripeFeesAll)} actual Stripe fees</small></article>
          <article className="financeSectionSnapshotEmphasis"><span>Operating net</span><strong>{money(totals.operatingNet)}</strong><small>Sales revenue minus fees and active expenses</small></article>
        </section>
        <section className="financeTableSection">
          <div className="financeTableHead"><div><div className="eyebrow">Customer money</div><h3>Payments & receipts</h3></div><span>{paidPayments.length} paid · {money(totals.receivedAll)} total</span></div>
          <div className="financeTableWrap"><table className="financeTable"><thead><tr><th>Date</th><th>Receipt</th><th>Order / customer</th><th>Gross</th><th>Tax held</th><th>Stripe fee</th><th>Sales revenue</th><th /></tr></thead><tbody>{paidPayments.length ? paidPayments.map((payment) => { const order = orderById.get(payment.request_id); const needsFee = payment.payment_method === "stripe" && payment.stripe_fee_cents == null; return <tr id={`payment-${payment.id}`} className={needsFee ? "financeRowNeedsAction" : ""} key={payment.id}><td>{localDate(payment.paid_at || payment.created_at)}</td><td>{receiptLabel(payment.receipt_number, payment.receipt_order_number || order?.request_number, payment.receipt_payment_sequence)}<small>{paymentMethodLabel(payment.payment_method)}</small></td><td><strong>{order ? formatRequestNumber(order.request_number) : "Order"}</strong><small>{order?.customer_name || ""}{order?.product ? ` · ${order.product}` : ""}</small>{order ? <button type="button" className="textButton financeOpenOrderLink" onClick={() => onOpenOrder(order.id)}>Open order →</button> : null}</td><td><strong>{money(payment.amount_cents)}</strong></td><td>{money(paymentTaxCollected(payment))}</td><td>{payment.payment_method === "stripe" ? needsFee ? <button type="button" className="textButton" disabled={syncingPaymentId === payment.id} onClick={() => void syncStripeSettlement(payment.id)}>{syncingPaymentId === payment.id ? "Syncing…" : "Sync fee"}</button> : money(paymentStripeFee(payment)) : "—"}</td><td><strong>{money(paymentSalesRevenue(payment))}</strong></td><td>{payment.receipt_token ? <a className="btn secondary financeReceiptButton" href={`/receipt/${payment.receipt_token}`} target="_blank" rel="noreferrer">Receipt ↗</a> : "—"}</td></tr>; }) : <tr><td colSpan={8}>No paid transactions yet.</td></tr>}</tbody></table></div>
        </section>

        <section className="financeTableSection">
          <div className="financeTableHead"><div><div className="eyebrow">Business spending</div><h3>Expenses</h3></div><strong>{money(totals.expensesAll)}</strong></div>
          <div className="financeTableWrap"><table className="financeTable financeExpenseTable"><thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Description</th><th>Receipts</th><th>Amount</th><th /></tr></thead><tbody>{expenses.length ? expenses.map((expense) => {
            const receipts = expense.receipts || [];
            return <tr key={expense.id} className={expense.voided_at ? "isVoided" : ""}><td>{localDate(`${expense.expense_date}T12:00:00`)}</td><td><strong>{expense.vendor}</strong>{expense.payment_method ? <small>{expense.payment_method}</small> : null}</td><td>{EXPENSE_CATEGORY_LABELS[expense.category]}</td><td>{expense.description || expense.note || "—"}{expense.voided_at ? <small>VOID · {expense.void_reason || "Voided"}</small> : null}</td><td><div className="expenseReceiptCell">{receipts.map((receipt, index) => <span className="expenseReceiptChip" key={receipt.id}>{receipt.url ? <a href={receipt.url} target="_blank" rel="noreferrer" title={receipt.original_filename}>Receipt {index + 1} ↗</a> : <span>Receipt {index + 1}</span>}{!expense.voided_at ? <button type="button" aria-label={`Remove ${receipt.original_filename}`} title="Remove receipt" disabled={deletingReceiptId === receipt.id} onClick={() => deleteReceipt(expense.id, receipt.id)}>×</button> : null}</span>)}{!expense.voided_at ? <label className={`expenseReceiptAdd ${uploadingReceiptFor === expense.id ? "isBusy" : ""}`}><input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif" disabled={uploadingReceiptFor === expense.id} onChange={(event) => { void uploadReceipts(expense.id, event.currentTarget.files); event.currentTarget.value = ""; }} />{uploadingReceiptFor === expense.id ? "Uploading…" : "+ Receipt"}</label> : null}</div></td><td><strong>{money(expense.amount_cents)}</strong>{expense.voided_at ? <small>VOID</small> : null}</td><td>{expense.voided_at ? <span className="fieldHelp">Preserved</span> : <button className="textButton financeDeleteButton" type="button" disabled={voidingExpenseId === expense.id} onClick={() => void voidExpense(expense.id)}>{voidingExpenseId === expense.id ? "Voiding…" : "Void"}</button>}</td></tr>;
          }) : <tr><td colSpan={7}>No business expenses recorded yet.</td></tr>}</tbody></table></div>
        </section>
      </> : null}

      {view === "funding" ? <>
        {fundingReady ? <section className="fundingOverview card">
          <div className="financePanelHead"><div><div className="eyebrow">Ownership & funding</div><h3>Keep ownership separate from who put in more cash.</h3></div><span className="ownershipLock">Ownership: Salvatore 50% · Matthew 50%</span></div>
          <p className="fieldHelp">Permanent owner contributions are tracked separately from loans and reimbursements. Funding records do not automatically change ownership.</p>
          {fundingByParty.length ? <div className="fundingPartyGrid">{fundingByParty.map((party) => {
            const loanOwed = Math.max(0, party.loans - party.loanRepaid);
            const reimbursementOwed = Math.max(0, party.reimbursementsDue - party.reimbursementsPaid);
            return <article key={party.name}><strong>{party.name}</strong><div><span>Permanent owner capital</span><b>{money(party.contributed)}</b></div>{party.draws ? <div className="fundingPartyDraw"><span>Owner draws received</span><b>{money(party.draws)}</b></div> : null}{party.gifts ? <div><span>Gifts / no repayment</span><b>{money(party.gifts)}</b></div> : null}<div><span>Loans owed back</span><b>{money(loanOwed)}</b></div><div><span>Reimbursements owed</span><b>{money(reimbursementOwed)}</b></div>{party.equity ? <div><span>Equity funding recorded</span><b>{money(party.equity)}</b></div> : null}</article>;
          })}</div> : <p className="muted">No funding entries yet. Use <strong>Add funding</strong> when an owner or family member contributes, lends money, or needs reimbursement.</p>}
        </section> : <div className="requestNote">Run the funding ledger migration to enable owner and family funding.</div>}

        {fundingReady ? <section className="financeTableSection">
          <div className="financeTableHead"><div><div className="eyebrow">Funding ledger</div><h3>Owner, family & outside money</h3></div><span>{activeFunding.length} active entries</span></div>
          <div className="financeTableWrap"><table className="financeTable fundingTable"><thead><tr><th>Date</th><th>Person</th><th>Type</th><th>Documents</th><th>Amount</th><th /></tr></thead><tbody>{funding.length ? funding.map((entry) => <tr key={entry.id} className={entry.voided_at ? "isVoided" : ""}><td>{localDate(`${entry.entry_date}T12:00:00`)}</td><td><strong>{entry.party_name}</strong><small>{FUNDING_PARTY_KIND_LABELS[entry.party_kind]}{entry.reference ? ` · ${entry.reference}` : ""}</small></td><td>{FUNDING_ENTRY_TYPE_LABELS[entry.entry_type]}{entry.ownership_percent != null ? <small>{entry.ownership_percent}% ownership documented</small> : null}{entry.note ? <small>{entry.note}</small> : null}</td><td><div className="fundingDocumentList">{(entry.documents || []).length ? (entry.documents || []).map((document, index) => document.url ? <a key={document.id} href={document.url} target="_blank" rel="noreferrer">Doc {index + 1} ↗</a> : <span key={document.id}>Doc {index + 1}</span>) : "—"}</div></td><td><strong>{money(entry.amount_cents)}</strong>{entry.voided_at ? <small>VOID</small> : null}</td><td>{entry.voided_at ? <span className="fieldHelp">{entry.void_reason || "Voided"}</span> : <button className="textButton financeDeleteButton" type="button" disabled={voidingFundingId === entry.id} onClick={() => void voidFunding(entry.id)}>{voidingFundingId === entry.id ? "Voiding…" : "Void"}</button>}</td></tr>) : <tr><td colSpan={6}>No funding entries recorded yet.</td></tr>}</tbody></table></div>
        </section> : null}
      </> : null}

      {view === "tax" ? <>
        <section className="card weeklyGoalCard taxReserveEstimateCard">
          <div className="weeklyGoalCardHead"><div><div className="eyebrow">Private planning estimate · {currentTaxYear}</div><h3>Owner tax reserve estimate</h3><p>Uses year-to-date business profit and conservatively includes 100% of direct outside gifts until their final income-tax treatment is documented. Sales tax stays separate.</p></div><span className="weeklyGoalSettingsHint">Reserve rate: {(incomeTaxReserveRate * 100).toFixed(0)}% · Editable in Products & Pricing</span></div>
          <div className="weeklyGoalReferenceNumbers">
            <div><span>Potential taxable amount</span><strong>{money(taxReserveEstimate.potentialTaxableIncome)}</strong></div>
            <div><span>Combined owner reserve</span><strong>{money(taxReserveEstimate.combinedOwnerReserve)}</strong></div>
            <div><span>Sal’s 50% planning share</span><strong>{money(taxReserveEstimate.salReserve)}</strong></div>
            <div><span>Matt’s 50% planning share</span><strong>{money(taxReserveEstimate.mattReserve)}</strong></div>
          </div>
          <div className="whyThisPriceRows">
            <div><span>Gross customer payments</span><strong>{money(taxReserveEstimate.grossCollected)}</strong></div>
            <div><span>Less sales tax collected</span><strong>−{money(taxReserveEstimate.salesTaxCollected)}</strong></div>
            <div><span>Business sales revenue</span><strong>{money(taxReserveEstimate.salesRevenue)}</strong></div>
            <div><span>Less actual Stripe fees</span><strong>−{money(taxReserveEstimate.stripeFees)}</strong></div>
            <div><span>Less recorded business expenses</span><strong>−{money(taxReserveEstimate.recordedExpenses)}</strong></div>
            <div><span>Estimated business profit before gifts</span><strong>{money(taxReserveEstimate.estimatedTaxableProfitBeforeGifts)}</strong></div>
            <div><span>Direct gifts to Moore Made LLC</span><strong>+{money(taxReserveEstimate.outsideGifts)}</strong></div>
            <div><span>Conservative reserve attributable to gifts</span><strong>{money(taxReserveEstimate.giftTaxReserve)}</strong></div>
            <div><span>Sales tax on genuine gifts</span><strong>$0.00</strong></div>
          </div>
          {taxReserveEstimate.missingStripeFees ? <div className="requestWarning financeActionWarning"><div><strong>Estimate needs fee reconciliation</strong><span>{taxReserveEstimate.missingStripeFees} Stripe payment{taxReserveEstimate.missingStripeFees === 1 ? "" : "s"} still need the actual settlement fee synced in Transactions.</span></div><button type="button" className="btn secondary" onClick={openFeeReconciliation}>Review & sync {taxReserveEstimate.missingStripeFees === 1 ? "payment" : "payments"} →</button></div> : null}
          <p className="financeDisclaimer">Planning estimate only. Direct gifts to a for-profit LLC are fact-specific for income-tax purposes, so this card reserves conservatively and does not decide the final return treatment. It does not know either owner’s other income, withholding, deductions, credits, residency, or prior-year safe harbor. Unpaid owner labor is not deducted as a tax expense.</p>
        </section>
        <section className="card taxReadinessPanel">
          <div className="financePanelHead"><div><div className="eyebrow">Tax-ready organization</div><h3>Year-round readiness</h3><p>This checks whether the portal records are organized and supported so you can make and document the final tax-filing treatment.</p></div><div className="taxReadinessBig"><strong>{readiness.score}%</strong><span>organized</span></div></div>
          <div className="financeReadinessBar financeReadinessBarLarge"><span style={{ width: `${readiness.score}%` }} /></div>
          <div className="taxReadinessChecklist">{readiness.checks.map((check) => <article key={check.label} className={check.ok ? "ready" : "needsWork"}><span>{check.ok ? "✓" : "!"}</span><div><strong>{check.label}</strong><p>{check.detail}</p></div></article>)}</div>
        </section>

        <section className="card financeExportCenter">
          <div className="financePanelHead"><div><div className="eyebrow">Accounting & tax filing</div><h3>Export clean records anytime.</h3><p>These files keep the operational portal easy to use while giving you structured records for QuickBooks, self-preparation, or a future professional review.</p></div></div>
          <div className="financeExportGrid"><button type="button" onClick={exportAccounting}><strong>Accounting export</strong><small>Payments + active expenses + funding</small></button><button type="button" onClick={exportPayments}><strong>Payments</strong><small>Receipts and customer money</small></button><button type="button" onClick={exportExpenses}><strong>Expenses</strong><small>Includes void status and receipts</small></button>{fundingReady ? <button type="button" onClick={exportFunding}><strong>Funding ledger</strong><small>Capital, loans and reimbursements</small></button> : null}{goalsReady ? <button type="button" onClick={exportGoals}><strong>Business goals</strong><small>Targets and funding progress</small></button> : null}{auditReady ? <button type="button" onClick={exportAudit}><strong>Audit journal</strong><small>Who changed what and when</small></button> : null}</div>
        </section>

        <section className="financeTableSection financeAuditSection">
          <div className="financeTableHead"><div><div className="eyebrow">Audit trail</div><h3>Financial change history</h3><p>Financial entries are preserved so corrections do not silently rewrite history.</p></div><span>{financeAudit.length} recent event{financeAudit.length === 1 ? "" : "s"}</span></div>
          {!auditReady ? <div className="requestNote">Run the Finance Command Center SQL migration to start the audit journal.</div> : financeAudit.length ? <div className="financeAuditList">{financeAudit.map((entry) => <details key={entry.id}><summary><span className={`auditAction audit-${entry.action}`}>{auditActionLabel(entry.action)}</span><span className="auditEntity">{auditEntityLabel(entry.entity_type)}</span><strong>{auditSummary(entry)}</strong><small>{localDateTime(entry.occurred_at)} · {entry.actor_user_id ? adminById.get(entry.actor_user_id) || "Admin" : "System / automated"}</small></summary><div className="auditDetails"><div><span>Record ID</span><code>{entry.entity_id || "—"}</code></div>{entry.before_data ? <details><summary>Before</summary><pre>{JSON.stringify(entry.before_data, null, 2)}</pre></details> : null}{entry.after_data ? <details><summary>After</summary><pre>{JSON.stringify(entry.after_data, null, 2)}</pre></details> : null}</div></details>)}</div> : <div className="empty compactEmpty"><p>No financial audit events yet. New financial activity will begin appearing here after the migration is installed.</p></div>}
        </section>
      </> : null}

      <p className="financeDisclaimer">Moore Made Admin is the day-to-day operational ledger and document hub. QuickBooks remains your formal accounting layer, and final tax classifications should be reviewed by your accountant/CPA.</p>
    </section>
  );
}
