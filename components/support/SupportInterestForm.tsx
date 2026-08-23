"use client";

import { useState } from "react";
import type { FormEvent } from "react";

export function SupportInterestForm({ token, phone }: { token: string; phone: string }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/support/${token}/interest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        phone: form.get("phone"),
        preferredContact: form.get("preferredContact"),
        amountRange: form.get("amountRange"),
        message: form.get("message"),
        website: form.get("website"),
        helpRequested: true,
        giftTermsAcknowledged: form.get("giftTermsAcknowledged") === "yes",
      }),
    });
    const data = await response.json().catch(() => ({}));
    setSending(false);
    if (!response.ok) {
      setError(data.error || "We could not send this message. Please call MooreMade.");
      return;
    }
    setSent(true);
  }

  if (sent) return <div className="supportThankYou"><span>✓</span><h2>Thank you for supporting Moore Made!</h2><p>Sal or Matt will contact you personally. No money has been transferred, and you have not committed to a gift.</p><a className="supportPrimaryButton" href={`tel:${phone}`}>Call MooreMade with questions</a></div>;

  return <section className="supportInterestCard" id="support-interest">
    <div className="supportSectionNumber">06</div>
    <div className="supportSectionCopy"><div className="supportEyebrow">No commitment</div><h2>Interested in helping?</h2><p>Tell us the easiest way to reach you. MooreMade will personally help with every step, including the gift letter and payment instructions.</p></div>
    <form id="support-form" className="supportInterestForm" onSubmit={submit}>
      <label><span>Your name</span><input name="name" autoComplete="name" required /></label>
      <div className="supportTwoCol"><label><span>Phone number</span><input name="phone" type="tel" autoComplete="tel" /></label><label><span>Email address</span><input name="email" type="email" autoComplete="email" /></label></div>
      <label><span>How should MooreMade contact you?</span><select name="preferredContact" defaultValue="phone"><option value="phone">Call me</option><option value="email">Email me</option><option value="either">Either is fine</option></select></label>
      <label><span>Amount you may be comfortable gifting <small>Optional</small></span><select name="amountRange" defaultValue=""><option value="">I’m not sure yet</option><option>Under $500</option><option>$500–$1,499</option><option>$1,500–$4,999</option><option>$5,000–$9,999</option><option>$10,000 or more</option></select></label>
      <label><span>Questions or a message <small>Optional</small></span><textarea name="message" rows={4} /></label>
      <label className="supportGiftConfirmation"><input name="giftTermsAcknowledged" value="yes" type="checkbox" required /><span>I understand this would be a voluntary gift to Moore Made LLC. I would not receive repayment, ownership, profit sharing, products, services, discounts, or control of the company.</span></label>
      <label className="supportHoney" aria-hidden="true"><span>Website</span><input name="website" tabIndex={-1} autoComplete="off" /></label>
      {error ? <div className="supportFormError">{error}</div> : null}
      <button className="supportSubmitButton" type="submit" disabled={sending}>{sending ? "Sending…" : "Ask MooreMade to contact me"}</button>
      <p className="supportFormFinePrint">Submitting this form does not transfer money or commit you or Moore Made to a gift.</p>
    </form>
  </section>;
}
