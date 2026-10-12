"use client";

import { useEffect, useState } from "react";
import { beachHousePayments, beachPaymentBreakdown, type BeachFrequency } from "@/lib/beach-house-payments";
import styles from "./page.module.css";

const storageKey = "beach-house-2027:checked:v1";

export function PaymentSchedule({ savedEnabled = false }: { savedEnabled?: boolean }) {
  const [frequency, setFrequency] = useState<BeachFrequency>("monthly");
  const [checked, setChecked] = useState<string[]>([]);
  const [savedProfile, setSavedProfile] = useState(false);
  const [savingCheck, setSavingCheck] = useState(false);
  const [checkError, setCheckError] = useState("");
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(saved)) setChecked(saved.filter((id): id is string => typeof id === "string" && beachHousePayments.some((payment) => payment.id === id)));
    } catch { /* Checking off payments still works when browser storage is unavailable. */ }
  }, []);

  useEffect(() => {
    if (!savedEnabled) return;
    const apply = (data: { member?: { checked_dates?: string[] } | null }) => {
      if (data.member) { setSavedProfile(true); setChecked(data.member.checked_dates || []); }
    };
    fetch("/api/beach-house-2027/tracker", { cache: "no-store" }).then(async (response) => { if (response.ok) apply(await response.json()); }).catch(() => {});
    const updated = (event: Event) => apply((event as CustomEvent).detail);
    window.addEventListener("beach-house-tracker-updated", updated);
    return () => window.removeEventListener("beach-house-tracker-updated", updated);
  }, [savedEnabled]);

  async function toggle(id: string) {
    const isChecked = !checked.includes(id);
    const next = isChecked ? [...checked, id] : checked.filter((item) => item !== id);
    setCheckError("");
    if (savedProfile) {
      setSavingCheck(true);
      try {
        const response = await fetch("/api/beach-house-2027/tracker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check", date: id, checked: isChecked }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not save your checklist.");
        setChecked(next);
        window.dispatchEvent(new Event("beach-house-tracker-check-changed"));
      } catch (problem) { setCheckError(problem instanceof Error ? problem.message : "Please try again."); }
      finally { setSavingCheck(false); }
    } else {
      setChecked(next);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Optional browser-local convenience. */ }
    }
  }

  return (
    <div className={styles.schedule}>
      <div className={styles.frequencyTabs} role="group" aria-label="Payment frequency">
        {(["monthly", "biweekly", "weekly"] as const).map((value) => <button type="button" aria-pressed={frequency === value} onClick={() => setFrequency(value)} key={value}>{value === "monthly" ? "Monthly" : value === "biweekly" ? "Every 2 weeks" : "Weekly"}</button>)}
      </div>
      <p className={styles.small}>{frequency === "monthly" ? "Five collection dates. Pay early or in smaller amounts if you prefer." : frequency === "biweekly" ? "Each monthly amount split into two payments, two weeks apart. Same totals and collection deadlines." : "Each monthly amount split into four weekly payments. Same totals and collection deadlines."}</p>
      {frequency !== "monthly" ? <p className={styles.small}>These are optional planning dates. Use the Monthly tab to save your collection checklist. Email reminders follow the five collection dates.</p> : null}
      <div className={styles.scheduleHead} aria-hidden="true"><span /><span>Payment date</span><span>Room / person</span><span>Pool</span><span /></div>
      {beachPaymentBreakdown(frequency).map((payment) => (
        <div className={`${styles.paymentRow} ${frequency === "monthly" && checked.includes(payment.id) ? styles.checked : ""}`} key={payment.id}>
          {frequency === "monthly" ? <input type="checkbox" checked={checked.includes(payment.id)} disabled={savingCheck} onChange={() => toggle(payment.id)} id={`payment-${payment.id}`} aria-label={`Mark ${payment.date} payment complete on your checklist`} /> : <span aria-hidden="true" />}
          <label htmlFor={frequency === "monthly" ? `payment-${payment.id}` : undefined}><span className={styles.fullDate}>{payment.date}</span><span className={styles.shortDate}>{payment.shortDate}</span></label>
          <span aria-label={`$${payment.room} per room, $${payment.person} per person`}>${payment.room}/{payment.person}</span>
          <span><span className={styles.fullPool}>{payment.pool}</span><span className={styles.shortPool}>{payment.pool.slice(0, 3)}</span></span>
          <a href={payment.href} aria-label={`Pay ${payment.date} in the ${payment.pool} Cash App pool`}>Pay now</a>
        </div>
      ))}
      {savedProfile ? <p className={styles.small}>Your checklist is saved to your account. Confirmed payment balances are shown below.</p> : null}
      {checkError ? <p role="alert" className={styles.formError}>{checkError}</p> : null}
    </div>
  );
}
