"use client";

import { useState } from "react";

type ProofChoice = { id: string; title: string };
type ItemChange = { key: string; proofItemId: string; message: string };

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function QuoteResponseButtons({ token, proofItems }: { token: string; proofItems: ProofChoice[] }) {
  const [working, setWorking] = useState<"approve" | "changes" | null>(null);
  const [result, setResult] = useState<"approved" | "changes_requested" | null>(null);
  const [approvedCheck, setApprovedCheck] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [generalChangeRequest, setGeneralChangeRequest] = useState("");
  const [itemChanges, setItemChanges] = useState<ItemChange[]>([
    { key: newKey(), proofItemId: proofItems[0]?.id ?? "", message: "" },
  ]);
  const [error, setError] = useState("");

  async function respond(responseValue: "approve" | "changes") {
    setError("");
    if (responseValue === "approve" && !approvedCheck) {
      setError("Please confirm that you reviewed every proof and the order details before approving.");
      return;
    }

    const cleanItemChanges = itemChanges
      .filter((change) => change.proofItemId && change.message.trim().length >= 3)
      .map((change) => ({ proofItemId: change.proofItemId, message: change.message.trim() }));

    if (responseValue === "changes" && generalChangeRequest.trim().length < 3 && cleanItemChanges.length === 0) {
      setError("Tell us what you would like changed. You can leave a general note or identify a specific product.");
      return;
    }

    setWorking(responseValue);
    try {
      const response = await fetch(`/api/quotes/${token}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: responseValue,
          generalChangeRequest: responseValue === "changes" ? generalChangeRequest.trim() : "",
          itemChanges: responseValue === "changes" ? cleanItemChanges : [],
          confirmed: responseValue === "approve" ? approvedCheck : false,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not record your response.");
      if (body.status === "approved") {
        window.location.reload();
        return;
      }
      setResult(body.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record your response.");
    } finally {
      setWorking(null);
    }
  }

  function updateItemChange(key: string, patch: Partial<ItemChange>) {
    setItemChanges((current) => current.map((change) => change.key === key ? { ...change, ...patch } : change));
  }

  if (result === "approved") {
    return <div className="quoteResponseSuccess"><strong>Proof + quote approved ✓</strong><p>You&apos;re all set. Moore Made will move forward using every approved product proof shown on this page and notify you again when your order is ready for pickup or has shipped.</p></div>;
  }

  if (result === "changes_requested") {
    return <div className="quoteResponseDeclined"><strong>Changes requested.</strong><p>We&apos;ve sent your notes to Moore Made. They&apos;ll update the affected proof(s) and send a new complete version for approval.</p></div>;
  }

  return (
    <div className="publicQuoteActions proofApprovalActions">
      {error ? <div className="formError">{error}</div> : null}

      <label className="proofApprovalCheck">
        <input type="checkbox" checked={approvedCheck} onChange={(e) => setApprovedCheck(e.target.checked)} />
        <span>I reviewed <strong>all product mockups</strong>, spelling, placement, item details, sizes/quantities, pricing, and payment terms shown above and approve this entire proof + quote for production.</span>
      </label>

      <button className="btn proofApproveButton" type="button" disabled={Boolean(working)} onClick={() => respond("approve")}>{working === "approve" ? "Approving…" : "Approve entire proof + quote"}</button>
      <button className="btn secondary" type="button" disabled={Boolean(working)} onClick={() => setShowChanges((value) => !value)}>{showChanges ? "Hide change request" : "Request changes instead"}</button>

      {showChanges ? <div className="proofChangesBox scalableChangesBox">
        <div className="proofChangeIntro"><strong>Only tell us what needs to change.</strong><p>If most products look correct, you don&apos;t need to re-explain them. Select the specific item(s) below.</p></div>

        <label className="field"><span>General order change <small>(optional)</small></span><textarea value={generalChangeRequest} maxLength={3000} onChange={(e) => setGeneralChangeRequest(e.target.value)} placeholder="Example: Please change the pickup date if possible." /></label>

        {proofItems.length ? <div className="itemChangeEditors">
          {itemChanges.map((change, index) => <div className="itemChangeEditor" key={change.key}>
            <label className="field"><span>Product / proof</span><select value={change.proofItemId} onChange={(e) => updateItemChange(change.key, { proofItemId: e.target.value })}><option value="">Choose an item</option>{proofItems.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
            <label className="field"><span>What should change?</span><textarea value={change.message} maxLength={3000} onChange={(e) => updateItemChange(change.key, { message: e.target.value })} placeholder="Example: Make the back logo about 2 inches smaller." /></label>
            {itemChanges.length > 1 ? <button type="button" className="textButton dangerText" onClick={() => setItemChanges((current) => current.filter((item) => item.key !== change.key))}>Remove this change</button> : null}
            {index < itemChanges.length - 1 ? <hr /> : null}
          </div>)}
          <button type="button" className="textButton" onClick={() => setItemChanges((current) => [...current, { key: newKey(), proofItemId: proofItems[0]?.id ?? "", message: "" }])}>+ Add change for another product</button>
        </div> : null}

        <button className="btn secondary" type="button" disabled={Boolean(working)} onClick={() => respond("changes")}>{working === "changes" ? "Sending…" : "Send change request"}</button>
      </div> : null}

      <p className="fieldHelp">Approval locks in every displayed product proof, the complete quote, and the payment terms. Secure payment is the next step.</p>
    </div>
  );
}
