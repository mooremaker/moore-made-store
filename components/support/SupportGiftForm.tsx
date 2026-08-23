"use client";

import { useState, type FormEvent } from "react";
import { GIFT_ACKNOWLEDGEMENT } from "@/lib/support-types";

export function SupportGiftForm() {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSending(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/support-gifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), email: form.get("email"), amount: form.get("amount"), message: form.get("message"), website: form.get("website"), acknowledged: form.get("acknowledged") === "yes" }) });
    const result = await response.json().catch(() => ({})); setSending(false);
    if (!response.ok) { setError(result.error || "We could not send your secure link."); return; }
    setDone(true);
  }
  if (done) return <div className="giftSuccess"><span>Check your email</span><h2>Your private Stripe link is on its way.</h2><p>No charge has been made yet. Open the secure link in the email to choose or confirm your amount and complete your voluntary gift.</p></div>;
  return <form className="giftForm" onSubmit={submit}>
    <div className="giftFormIntro"><span>Private, secure next step</span><h2>Tell us where to send your gift link.</h2><p>Stripe handles payment securely. Moore Made never receives your card number.</p></div>
    <div className="giftFormGrid"><label><span>Your name</span><input name="name" required autoComplete="name" /></label><label><span>Email</span><input name="email" type="email" required autoComplete="email" /></label></div>
    <label><span>Amount <small>Optional</small></span><div className="giftAmount"><b>$</b><input name="amount" type="number" min="1" max="1000000" step="0.01" inputMode="decimal" placeholder="Choose now or later in Stripe" /></div></label>
    <label><span>Message <small>Optional</small></span><textarea name="message" rows={4} maxLength={1500} placeholder="A note for Sal and Matt" /></label>
    <input className="giftHoneypot" name="website" tabIndex={-1} autoComplete="off" />
    <label className="giftAcknowledgement"><input name="acknowledged" type="checkbox" value="yes" required /><span><strong>Required acknowledgement</strong>{GIFT_ACKNOWLEDGEMENT}</span></label>
    {error ? <div className="formError">{error}</div> : null}
    <button className="giftSubmit" type="submit" disabled={sending}>{sending ? "Creating your secure link…" : "Email my secure Stripe link"}</button>
    <p className="giftFormFinePrint">Submitting this form does not charge you. The unique checkout link is emailed only to the address above.</p>
  </form>;
}
