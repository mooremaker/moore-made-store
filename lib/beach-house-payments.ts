export const beachHousePayments = [
  { id: "2026-11-15", date: "Nov 15, 2026", shortDate: "Nov 15, ’26", room: "250", person: "125", pool: "January", href: "https://cash.app/f/POOL?id=0c9zfc2r" },
  { id: "2026-12-15", date: "Dec 15, 2026", shortDate: "Dec 15, ’26", room: "250", person: "125", pool: "January", href: "https://cash.app/f/POOL?id=0c9zfc2r" },
  { id: "2027-01-15", date: "Jan 15, 2027", shortDate: "Jan 15, ’27", room: "150", person: "75", pool: "April", href: "https://cash.app/f/POOL?id=nyi1n898" },
  { id: "2027-02-15", date: "Feb 15, 2027", shortDate: "Feb 15, ’27", room: "150", person: "75", pool: "April", href: "https://cash.app/f/POOL?id=nyi1n898" },
  { id: "2027-03-15", date: "Mar 15, 2027", shortDate: "Mar 15, ’27", room: "162", person: "81", pool: "April", href: "https://cash.app/f/POOL?id=nyi1n898" },
] as const;

export function easternDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function dueReminders(today: string) {
  const day = Date.parse(`${today}T12:00:00Z`);
  return beachHousePayments.flatMap((payment) => {
    const days = Math.round((Date.parse(`${payment.id}T12:00:00Z`) - day) / 86400000);
    return [14, 7, 0].includes(days) ? [{ payment, days }] : [];
  });
}

export type BeachFrequency = "monthly" | "biweekly" | "weekly";

// Each collection retains its exact total and deadline; alternative views split it up.
export function beachPaymentBreakdown(frequency: BeachFrequency) {
  const count = frequency === "weekly" ? 4 : frequency === "biweekly" ? 2 : 1;
  return beachHousePayments.flatMap((payment) => Array.from({ length: count }, (_, index) => {
    const date = new Date(`${payment.id}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (count - 1 - index) * (frequency === "biweekly" ? 14 : 7));
    const id = date.toISOString().slice(0, 10);
    const format = (amount: string) => (Number(amount) / count).toFixed(2).replace(/\.00$/, "");
    return { ...payment, id, collectionId: payment.id,
      date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date),
      shortDate: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date),
      room: format(payment.room), person: format(payment.person) };
  }));
}
