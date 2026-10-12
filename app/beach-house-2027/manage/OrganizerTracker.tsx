"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { beachBalances, beachMoney, type BeachMember, type BeachContribution } from "@/lib/beach-house-tracker";
import { easternDate } from "@/lib/beach-house-payments";
import styles from "../page.module.css";

export default function OrganizerTracker() {
  const [members, setMembers] = useState<BeachMember[]>([]);
  const [records, setRecords] = useState<BeachContribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const addId = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const response = await fetch("/api/beach-house-2027/manage", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load organizer records.");
    setMembers(result.members); setRecords(result.records);
  }, []);
  useEffect(() => { reload().catch((problem) => setError(problem.message)).finally(() => setLoading(false)); }, [reload]);

  async function save(body: object) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/beach-house-2027/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this update.");
      await reload(); setMessage("Organizer records updated."); return true;
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Please try again."); return false; }
    finally { setBusy(false); }
  }

  async function approve(event: FormEvent<HTMLFormElement>, memberId: string) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await save({ action: "approveMember", memberId, room: Number(form.get("room")), sharePeople: Number(form.get("sharePeople")) });
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; const form = new FormData(element);
    addId.current ||= crypto.randomUUID();
    if (await save({ action: "add", id: addId.current, memberId: form.get("memberId"), pool: form.get("pool"), amount: form.get("amount"), date: form.get("date"), reference: form.get("reference") })) { addId.current = null; element.reset(); }
  }
  const active = members.filter((member) => member.status === "active");
  const pending = records.filter((record) => record.status === "pending");
  return <div className={styles.organizer}>
    {error ? <p role="alert" className={styles.formError}>{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <button disabled={busy} onClick={() => { setError(""); reload().catch((problem) => setError(problem.message)); }}>Refresh contributions</button>
    {loading ? <p>Loading…</p> : <>
      <h2>People and room shares</h2>
      {!members.length ? <p>People appear here after signing in and saving their trip profile.</p> : members.map((member) => {
        const balance = beachBalances(member.share_people, records.filter((record) => record.member_id === member.user_id));
        return <article className={styles.organizerCard} key={member.user_id}>
          <strong>{member.display_name}</strong><p>{member.email}<br />Cash App: {member.cash_app_name}</p>
          <p>{member.status === "active" ? `${beachMoney(balance.paid)} confirmed · ${beachMoney(balance.remaining)} remaining` : member.status === "inactive" ? "Inactive trip profile" : "Room assignment awaiting confirmation"}</p>
          <form onSubmit={(event) => void approve(event, member.user_id)} className={styles.trackerForm}>
            <div className={styles.formColumns}><label>Room<select name="room" defaultValue={member.room_number}>{[1,2,3,4].map((room) => <option value={room} key={room}>Room {room}</option>)}</select></label><label>Share<select name="sharePeople" defaultValue={member.share_people}><option value="2">Half room</option><option value="1">Full room</option></select></label></div>
            <button disabled={busy}>{member.status === "active" ? "Update room assignment" : "Confirm room assignment"}</button>
          </form>
          {member.status === "active" ? <button disabled={busy} onClick={() => void save({ action: "deactivateMember", memberId: member.user_id })}>Remove from room</button> : null}
        </article>;
      })}
      <h2>Payments awaiting confirmation ({pending.length})</h2>
      {!pending.length ? <p>No contributions awaiting review.</p> : pending.map((record) => {
        const member = members.find((person) => person.user_id === record.member_id);
        return <article className={styles.organizerCard} key={record.id}>
          <strong>{member?.display_name || "Trip participant"} · {beachMoney(record.amount_cents)}</strong>
          <p>{record.paid_date} · {record.pool_key === "january" ? "January pool" : "April pool"}<br />Cash App: {member?.cash_app_name}{record.reference ? <><br />Reference: {record.reference}</> : null}</p>
          <div className={styles.trackerActions}><button className={styles.trackerPrimary} disabled={busy || member?.status !== "active"} onClick={() => void save({ action: "review", id: record.id, status: "confirmed", expectedStatus: record.status })}>Confirm received in Cash App</button><button disabled={busy} onClick={() => void save({ action: "review", id: record.id, status: "rejected", expectedStatus: record.status })}>Don’t count this entry</button></div>
        </article>;
      })}
      <details className={styles.details}><summary>Add a payment from Cash App</summary>
        <p>Use this when someone paid but didn’t record it. Check Cash App first; this entry will be confirmed immediately.</p>
        <form onSubmit={add} onChange={() => { addId.current = null; }} className={styles.trackerForm}>
          <label>Person<select name="memberId" required defaultValue=""><option value="" disabled>Select person</option>{active.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name} · Room {member.room_number}</option>)}</select></label>
          <div className={styles.formColumns}><label>Amount ($)<input name="amount" type="number" inputMode="decimal" min="0.01" max="962" step="0.01" required /></label><label>Pool<select name="pool"><option value="january">January</option><option value="april">April</option></select></label></div>
          <label>Payment date<input type="date" name="date" defaultValue={easternDate()} min="2026-01-01" max={easternDate()} required /></label>
          <label>Transaction reference <small>(optional)</small><input name="reference" maxLength={120} /></label>
          <button className={styles.trackerPrimary} disabled={busy || !active.length}>Add confirmed payment</button>
        </form>
      </details>
      <details className={styles.details}><summary>Reviewed payment history</summary>{records.filter((record) => record.status !== "pending").map((record) => <div className={styles.historyRow} key={record.id}><div><strong>{members.find((member) => member.user_id === record.member_id)?.display_name} · {beachMoney(record.amount_cents)}</strong><span>{record.paid_date} · {record.pool_key} · {record.status}</span></div><button disabled={busy} onClick={() => void save({ action: "review", id: record.id, status: "pending", expectedStatus: record.status })}>Return to review</button></div>)}</details>
    </>}
  </div>;
}
