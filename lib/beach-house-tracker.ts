import { beachHousePayments } from "@/lib/beach-house-payments";

export type BeachPool = "january" | "april";
export type BeachMember = { user_id: string; email: string; display_name: string; cash_app_name: string; room_number: number; share_people: 1 | 2; status: "pending" | "active" | "inactive"; checked_dates: string[] };
export type BeachContribution = { id: string; member_id: string; pool_key: BeachPool; amount_cents: number; paid_date: string; reference: string | null; status: "pending" | "confirmed" | "rejected"; created_at: string; reviewed_at: string | null };

export function parseBeachAmount(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,4}(\.\d{1,2})?$/.test(value.trim())) return null;
  const [dollars, cents = ""] = value.trim().split(".");
  const amount = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  return amount > 0 && amount <= 96200 ? amount : null;
}

export function beachMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

export function beachBalances(sharePeople: 1 | 2, records: Pick<BeachContribution, "pool_key" | "amount_cents" | "status">[]) {
  const pools = (["january", "april"] as const).map((key) => {
    const goal = (key === "january" ? 50000 : 46200) / sharePeople;
    const matching = records.filter((record) => record.pool_key === key);
    const paid = matching.filter((record) => record.status === "confirmed").reduce((sum, record) => sum + record.amount_cents, 0);
    const pending = matching.filter((record) => record.status === "pending").reduce((sum, record) => sum + record.amount_cents, 0);
    return { key, goal, paid, pending, remaining: Math.max(0, goal - paid), applied: Math.min(goal, paid) };
  });
  return { pools, goal: pools.reduce((sum, pool) => sum + pool.goal, 0), paid: pools.reduce((sum, pool) => sum + pool.paid, 0), pending: pools.reduce((sum, pool) => sum + pool.pending, 0), remaining: pools.reduce((sum, pool) => sum + pool.remaining, 0), applied: pools.reduce((sum, pool) => sum + pool.applied, 0) };
}

export function beachInstallmentCoverage(sharePeople: 1 | 2, records: Pick<BeachContribution, "pool_key" | "amount_cents" | "status">[]) {
  const balances = beachBalances(sharePeople, records);
  const spent = { january: 0, april: 0 };
  return beachHousePayments.map((payment) => {
    const key: BeachPool = payment.pool === "January" ? "january" : "april";
    const due = Math.round(Number(payment.room) * 100) / sharePeople;
    const paid = balances.pools.find((pool) => pool.key === key)!.paid;
    const credited = Math.max(0, Math.min(due, paid - spent[key]));
    spent[key] += due;
    return { id: payment.id, due, credited, remaining: due - credited, covered: credited >= due };
  });
}

export function validBeachDate(value: unknown, today: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2026-01-01" || value > today) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
