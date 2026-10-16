"use client";

import { useRef, useState } from "react";
import { followUpDraft, followUpRecipients } from "@/lib/follow-up";

type Props = {
  requestId: string;
  reviewId: string;
  version: number;
  recipients: string[];
  files: Array<{ path: string; originalName: string }>;
};

export function MockupFollowUp({ requestId, reviewId, version, recipients, files }: Props) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(recipients.join(", "));
  const [subject, setSubject] = useState("Checking in on your Moore Made mockups");
  const [message, setMessage] = useState(followUpDraft());
  const [attach, setAttach] = useState(files.length > 0);
  const [preview, setPreview] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryRecipients, setRetryRecipients] = useState<string[] | null>(null);
  const sendId = useRef<string | null>(null);
  const sending = useRef(false);

  function reviewDraft() {
    try {
      followUpRecipients(to);
      if (subject.trim().length < 3 || message.trim().length < 3) throw new Error("Add a subject and message.");
      setError(""); setPreview(true);
    } catch (reason) { setError((reason as Error).message); }
  }

  async function send() {
    if (sending.current || done) return;
    sending.current = true;
    setWorking(true); setAttempted(true); setError(""); setNotice("");
    sendId.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/admin/follow-up", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, reviewId, sendId: sendId.current, recipientEmails: retryRecipients?.join(", ") || to, subject, message, includeMockups: attach }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not send the follow-up.");
      const sent = Array.isArray(result.sent) ? result.sent : [];
      const failed = Array.isArray(result.failed) ? result.failed : [];
      setNotice(`Follow-up sent to ${sent.join(", ")}.${result.historySaved === false ? " Email sent, but the audit log could not be saved. Do not send again to repair history." : " Saved in customer email activity."}`);
      if (failed.length) {
        setRetryRecipients(failed.map((item: { email: string }) => item.email));
        setError(`Not sent to ${failed.map((item: { email: string }) => item.email).join(", ")}. Retry sends only to these addresses.`);
      } else { setDone(true); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send the follow-up. Retry the same draft."); }
    finally { sending.current = false; setWorking(false); }
  }

  return <div>
    <button type="button" className="btn secondary" onClick={() => setOpen(value => !value)} aria-expanded={open}>Send follow-up</button>
    {open ? <div className="orderNotificationBody">
      <strong>Follow up on proof {version}</strong>
      <p className="muted">This keeps the same mockups and approval link. Review your message before sending.</p>
      {!preview ? <>
        <label className="field"><span>Send to</span><input value={to} onChange={event => setTo(event.target.value)} maxLength={3200} /></label>
        <label className="field"><span>Subject</span><input value={subject} onChange={event => setSubject(event.target.value)} maxLength={180} /></label>
        <label className="field"><span>Follow-up message</span><textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={4000} rows={7} /></label>
        <label><input type="checkbox" checked={attach} disabled={!files.length} onChange={event => setAttach(event.target.checked)} /> Reattach the saved mockups</label>
        <button type="button" className="btn" onClick={reviewDraft}>Review follow-up</button>
      </> : <>
        <p><strong>To:</strong> {to}</p><p><strong>Subject:</strong> {subject}</p>
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message}</div>
        <p><strong>Attachments:</strong> {attach ? files.map(file => file.originalName).join(", ") : "None — the review link is included."}</p>
        <p>Includes the existing proof {version} review link and a reply option.</p>
        {!attempted ? <button type="button" className="btn secondary" onClick={() => setPreview(false)}>Edit draft</button> : null}
        <button type="button" className="btn" disabled={working || done} onClick={() => void send()}>{working ? "Sending…" : done ? "Follow-up sent" : attempted ? "Retry follow-up" : "Send follow-up email"}</button>
      </>}
      {notice ? <div className="formSuccess" role="status">{notice}</div> : null}
      {error ? <div className="formError" role="alert">{error}</div> : null}
    </div> : null}
  </div>;
}
