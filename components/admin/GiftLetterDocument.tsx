"use client";

import { useState } from "react";

export function GiftLetterDocument({ donorName, inquiryId }: { donorName: string; inquiryId: string }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  return <div className="giftLetterPage">
    <div className="giftLetterControls"><label>Final gift amount <input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label><label>Gift date <input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><button className="btn" type="button" onClick={() => window.print()}>Print / Save PDF</button></div>
    <article className="giftLetterDocument">
      <header><strong>MOORE<span>/</span>MADE</strong><small>Your Idea. Moore Made.</small></header>
      <div className="giftLetterTitle"><span>VOLUNTARY BUSINESS GIFT LETTER</span><h1>Gift to Moore Made LLC</h1></div>
      <dl><div><dt>Donor</dt><dd>{donorName}</dd></div><div><dt>Recipient</dt><dd>Moore Made LLC</dd></div><div><dt>Gift amount</dt><dd>{amount ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(amount)) : "________________"}</dd></div><div><dt>Gift date</dt><dd>{date || "________________"}</dd></div></dl>
      <p>I, <strong>{donorName}</strong>, am voluntarily giving the amount shown above directly to <strong>Moore Made LLC</strong>.</p>
      <p>This gift is unconditional and is made from generosity. I do not expect and have not been promised repayment, interest, ownership, profit sharing, revenue sharing, voting rights, management authority, products, services, discounts, or any other financial or commercial benefit in return.</p>
      <p>I understand that Moore Made LLC is a for-profit business. This gift is not represented as a charitable contribution or as tax-deductible. Moore Made may use the funds for lawful business needs, including working capital, supplies, equipment, packaging, shipping, marketing, software, training, and other operating expenses.</p>
      <p>I understand that a stated preference about how the funds may be used is not a repayment obligation, ownership agreement, or guarantee of a particular purchase or business result.</p>
      <div className="giftLetterSignatures"><div><span>Donor signature</span><b>________________________________________</b><small>Date: ____________________</small></div><div><span>Accepted for Moore Made LLC</span><b>________________________________________</b><small>Date: ____________________</small></div></div>
      <footer><span>Internal reference: {inquiryId}</span><span>Retain with the deposit and funding-ledger record.</span></footer>
    </article>
  </div>;
}
