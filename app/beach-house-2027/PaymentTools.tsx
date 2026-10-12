"use client";

import { useEffect, useState, type FormEvent } from "react";
import { beachHousePayments } from "@/lib/beach-house-payments";
import styles from "./page.module.css";

const storageKey = "beach-house-2027:checked:v1";

export function PaymentSchedule() {
  const [checked, setChecked] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(saved)) setChecked(saved.filter((id): id is string => typeof id === "string" && beachHousePayments.some((payment) => payment.id === id)));
    } catch { /* Checking off payments still works when browser storage is unavailable. */ }
  }, []);

  function toggle(id: string) {
    const next = checked.includes(id) ? checked.filter((item) => item !== id) : [...checked, id];
    setChecked(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Optional browser-local convenience. */ }
  }

  return (
    <div className={styles.schedule}>
      <div className={styles.scheduleHead} aria-hidden="true"><span /><span>Payment date</span><span>Room / person</span><span>Pool</span><span /></div>
      {beachHousePayments.map((payment) => (
        <div className={`${styles.paymentRow} ${checked.includes(payment.id) ? styles.checked : ""}`} key={payment.id}>
          <input type="checkbox" checked={checked.includes(payment.id)} onChange={() => toggle(payment.id)} id={`payment-${payment.id}`} aria-label={`Mark ${payment.date} payment complete on this device`} />
          <label htmlFor={`payment-${payment.id}`}><span className={styles.fullDate}>{payment.date}</span><span className={styles.shortDate}>{payment.shortDate}</span></label>
          <span aria-label={`$${payment.room} per room, $${payment.person} per person`}>${payment.room}/{payment.person}</span>
          <span><span className={styles.fullPool}>{payment.pool}</span><span className={styles.shortPool}>{payment.pool.slice(0, 3)}</span></span>
          <a href={payment.href} aria-label={`Pay ${payment.date} in the ${payment.pool} Cash App pool`}>Pay now</a>
        </div>
      ))}
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
