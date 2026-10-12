"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { beachBalances, beachInstallmentCoverage, beachMoney, type BeachMember, type BeachContribution } from "@/lib/beach-house-tracker";
import { easternDate } from "@/lib/beach-house-payments";
import styles from "./page.module.css";

type Snapshot = { email: string; member: BeachMember | null; records: BeachContribution[]; organizer: boolean; reminders: boolean };

export default function SavedTracker({ enabled, remindersEnabled }: { enabled: boolean; remindersEnabled: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const reportId = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const response = await fetch("/api/beach-house-2027/tracker", { cache: "no-store" });
    if (response.status === 401) { setSignedOut(true); setSnapshot(null); return; }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load your progress.");
    setSnapshot(data); setSignedOut(false);
    window.dispatchEvent(new CustomEvent("beach-house-tracker-updated", { detail: data }));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    reload().catch((problem) => { if (current) setError(problem.message); }).finally(() => { if (current) setLoading(false); });
    const checklistChanged = () => { reload().catch((problem) => { if (current) setError(problem.message); }); };
    window.addEventListener("beach-house-tracker-check-changed", checklistChanged);
    return () => { current = false; window.removeEventListener("beach-house-tracker-check-changed", checklistChanged); };
  }, [enabled, reload]);

  async function save(body: object, success: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/beach-house-2027/tracker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save your progress.");
      await reload(); setMessage(data.warning || success);
      return true;
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Please try again."); return false; }
    finally { setBusy(false); }
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await save({ action: "join", name: form.get("name"), cashAppName: form.get("cashAppName"), sharePeople: Number(form.get("sharePeople")), reminders: form.get("reminders") === "on" }, "Your trip profile is saved. Sal will confirm your share.");
  }

  async function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    reportId.current ||= crypto.randomUUID();
    const saved = await save({ action: "report", id: reportId.current, amount: form.get("amount"), date: form.get("date"), pool: form.get("pool"), reference: form.get("reference") }, "Payment recorded—awaiting Sal’s confirmation in Cash App.");
    if (saved) { reportId.current = null; setReporting(false); }
  }

  if (!enabled) return null;
  const member = snapshot?.member;
  const balances = member ? beachBalances(member.share_people, snapshot!.records) : null;
  const coverage = member ? beachInstallmentCoverage(member.share_people, snapshot!.records) : [];
  return <section id="my-progress" className={styles.section} aria-labelledby="progress-heading">
    <h2 id="progress-heading">My progress &amp; reminders</h2>
    {loading ? <p role="status">Loading your saved progress…</p> : signedOut ? <><p>Pay in smaller amounts whenever it suits you. Sign in once to save your contributions and checklist across devices and choose email reminders.</p><Link className={styles.button} href="/beach-house-2027/sign-in">Sign in to get started</Link></> : snapshot ? <>
      <div className={styles.trackerTop}><span>{member?.display_name || snapshot.email}</span><div>{snapshot.organizer ? <Link href="/beach-house-2027/manage">Organizer view</Link> : null}<form action="/api/auth/logout" method="POST"><input type="hidden" name="next" value="/beach-house-2027" /><button type="submit">Sign out</button></form></div></div>
      {!member ? <form className={styles.trackerForm} onSubmit={join}>
        <label>Your name<input name="name" maxLength={100} autoComplete="name" required /></label>
        <label>Name or $Cashtag in Cash App<input name="cashAppName" maxLength={100} placeholder="So Sal can match your payments" required /></label>
        <label>Are you sharing a room?<select name="sharePeople" defaultValue="2"><option value="2">Yes — I’m paying half</option><option value="1">No — I’m paying for the full room</option></select></label>
        <p className={styles.small}>If you’re sharing, remind your roommate to make their payments too. Each person tracks their own share.</p>
        {remindersEnabled ? <label className={styles.reminderChoice}><input type="checkbox" name="reminders" disabled={busy} defaultChecked /><span>Email me reminders two weeks before, one week before, and on each collection date.</span></label> : null}
        <button className={styles.trackerPrimary} disabled={busy}>Save my trip profile</button>
      </form> : member.status === "pending" ? <p>Your profile is saved. Sal will confirm your share before payment recording is available.</p> : member.status === "inactive" ? <p>Your trip profile is inactive. Contact Sal if your plans have changed.</p> : balances ? <>
        <p className={styles.small}>{member.share_people === 2 ? "Half-room share" : "Full-room share"} · Total share {beachMoney(balances.goal)}</p>
        <div className={styles.balanceGrid}><div><span>Confirmed paid</span><strong>{beachMoney(balances.paid)}</strong></div><div><span>Remaining</span><strong>{beachMoney(balances.remaining)}</strong></div></div>
        {balances.pending ? <p className={styles.small}>{beachMoney(balances.pending)} awaiting confirmation.</p> : null}
        <div className={styles.poolBalances}>{balances.pools.map((pool) => <div key={pool.key}><span>{pool.key === "january" ? "January pool" : "April pool"}</span><strong>{beachMoney(pool.paid)} / {beachMoney(pool.goal)}</strong><progress value={pool.applied} max={pool.goal} aria-label={`${pool.key} pool progress`} /></div>)}</div>
        <div className={styles.trackerActions}><button className={styles.trackerPrimary} onClick={() => setReporting((open) => !open)}>{reporting ? "Close payment form" : "I made a payment"}</button><button onClick={() => { setError(""); reload().catch((problem) => setError(problem.message)); }}>Refresh</button></div>
        {reporting ? <form onSubmit={report} onChange={() => { reportId.current = null; }} className={styles.trackerForm}>
          <p>Pay through the Cash App pool first, then record it here. Any smaller contribution counts toward your share after Sal confirms it.</p>
          <div className={styles.formColumns}><label>Amount paid ($)<input name="amount" inputMode="decimal" type="number" min="0.01" max="962" step="0.01" placeholder="50.00" required /></label><label>Pool<select name="pool" defaultValue={balances.pools[0].remaining ? "january" : "april"}><option value="january">January</option><option value="april">April</option></select></label></div>
          <label>Payment date<input type="date" name="date" defaultValue={easternDate()} min="2026-01-01" max={easternDate()} required /></label>
          <label>Cash App transaction reference <small>(optional)</small><input name="reference" maxLength={120} /></label>
          <button className={styles.trackerPrimary} disabled={busy}>{busy ? "Saving…" : "Record payment"}</button>
        </form> : null}
        <details className={styles.details}><summary>My saved checklist</summary><p className={styles.small}>Ticks are personal notes. Confirmed balances come from Sal’s payment review.</p>{coverage.map((item) => <label className={styles.savedCheck} key={item.id}><input type="checkbox" checked={member.checked_dates.includes(item.id)} disabled={busy} onChange={(event) => void save({ action: "check", date: item.id, checked: event.target.checked }, "Checklist saved to your account.")} /><span style={{ textDecoration: member.checked_dates.includes(item.id) ? "line-through" : undefined }}>{item.id} · {beachMoney(item.due)}</span><small>{item.covered ? "Covered" : `${beachMoney(item.remaining)} remaining`}</small></label>)}</details>
      </> : null}
      {member && remindersEnabled ? <form className={styles.reminderSettings} onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); await save({ action: "reminders", enabled: form.get("reminders") === "on" }, "Email preferences saved."); }}>
        <label className={styles.reminderChoice}><input key={String(snapshot.reminders)} type="checkbox" name="reminders" disabled={busy} defaultChecked={snapshot.reminders} /><span>Email me payment reminders</span></label>
        <p className={styles.small}>Two weeks before, one week before, and on the five collection dates. You can turn these off anytime.</p>
        {member.share_people === 2 ? <p className={styles.small}>Remind your roommate to make their payments too — their share is tracked separately.</p> : null}
        <button type="submit" className={styles.trackerPrimary} disabled={busy}>Save reminder preference</button>
      </form> : null}
      {snapshot.records.length ? <details className={styles.details} open><summary>My payment history</summary>{snapshot.records.map((record) => <div className={styles.historyRow} key={record.id}><div><strong>{beachMoney(record.amount_cents)}</strong><span>{record.paid_date} · {record.pool_key === "january" ? "January" : "April"}</span></div><div><span>{record.status === "confirmed" ? "Confirmed" : record.status === "pending" ? "Awaiting confirmation" : "Not counted"}</span>{record.status === "pending" ? <button disabled={busy} onClick={() => void save({ action: "withdraw", id: record.id }, "Pending entry removed from the tracker.")}>Remove entry</button> : null}</div></div>)}</details> : null}
    </> : error ? null : <p>Could not load your tracker.</p>}
    {error ? <p role="alert" className={styles.formError}>{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
