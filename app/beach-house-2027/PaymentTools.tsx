"use client";

import { useEffect, useState, type FormEvent } from "react";
import { beachHousePayments } from "@/lib/beach-house-payments";
import styles from "./page.module.css";

const storageKey = "beach-house-2027:checked:v1";

export function PaymentSchedule({ savedEnabled = false }: { savedEnabled?: boolean }) {
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
      <div className={styles.scheduleHead} aria-hidden="true"><span /><span>Payment date</span><span>Room / person</span><span>Pool</span><span /></div>
      {beachHousePayments.map((payment) => (
        <div className={`${styles.paymentRow} ${checked.includes(payment.id) ? styles.checked : ""}`} key={payment.id}>
          <input type="checkbox" checked={checked.includes(payment.id)} disabled={savingCheck} onChange={() => toggle(payment.id)} id={`payment-${payment.id}`} aria-label={`Mark ${payment.date} payment complete on your checklist`} />
          <label htmlFor={`payment-${payment.id}`}><span className={styles.fullDate}>{payment.date}</span><span className={styles.shortDate}>{payment.shortDate}</span></label>
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

export function EmailUpdates({ enabled = false }: { enabled?: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/beach-house-2027/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, consent: true, website: new FormData(event.currentTarget).get("website") }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Please try again shortly.");
      setMessage(result.message || "Check your inbox to confirm your email and turn on reminders.");
      setEmail("");
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Please try again shortly."); }
    finally { setBusy(false); }
  }

  return (
    <section className={styles.section} aria-labelledby="email-heading">
      <h2 id="email-heading">Want email updates?</h2>
      <p>Get payment reminders two weeks before, one week before, and on each payment date.</p>
      <form onSubmit={subscribe} className={styles.emailForm}>
        <label htmlFor="beach-email">Email address</label>
        <div className={styles.emailFields}><input id="beach-email" type="email" autoComplete="email" maxLength={254} placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={busy || !enabled} /><button type="submit" disabled={busy || !enabled}>{busy ? "Sending…" : "Send me reminders"}</button></div>
        <label className={styles.honeypot}>Website<input name="website" autoComplete="off" tabIndex={-1} /></label>
        <p className={styles.small}>{enabled ? "Confirm your email to start. You can unsubscribe anytime." : "Email reminders are being set up. Check back soon."}</p>
        {message ? <p role="status">{message}</p> : null}
        {error ? <p role="alert" className={styles.formError}>{error}</p> : null}
      </form>
    </section>
  );
}
