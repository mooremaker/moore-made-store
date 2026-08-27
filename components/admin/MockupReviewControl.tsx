"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

const BUCKET = "quote-proof-files";
type UploadedFile = { path: string; originalName: string };
type Review = { id: string; version: number; recipient_emails: string[]; note: string | null; sent_at: string; approved_at: string | null; files: Array<UploadedFile & { url: string | null }> };
type Props = { requestId: string; customerName: string; customerEmail: string };

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function MockupReviewControl({ requestId, customerName, customerEmail }: Props) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [history, setHistory] = useState<Review[]>([]);
  const [email, setEmail] = useState(customerEmail);
  const [note, setNote] = useState("Please review the attached mockup designs and let us know whether you approve the design direction or would like any changes.");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadHistory() {
    const response = await fetch("/api/admin/mockup-review?requestId=" + encodeURIComponent(requestId));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load sent mockups.");
    setHistory(Array.isArray(result.reviews) ? result.reviews : []);
  }

  useEffect(() => { void loadHistory().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load sent mockups.")); }, [requestId]);

  async function choose(selected: FileList | null) {
    const picks = Array.from(selected || []);
    if (!picks.length) return;
    setWorking(true); setError("");
    try {
      const prep = await fetch("/api/admin/quote-proof-uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, itemKey: "mockup-review", files: picks.map((file) => ({ name: file.name, size: file.size, type: file.type })) }) });
      const targets = await prep.json();
      if (!prep.ok) throw new Error(targets.error || "Could not prepare mockup upload.");
      const supabase = getSupabaseBrowser();
      const uploaded: UploadedFile[] = [];
      for (const target of targets.uploads || []) {
        const file = picks[target.index];
        if (!file) continue;
        const { error: uploadError } = await supabase.storage.from(BUCKET).uploadToSignedUrl(target.path, target.token, file, { contentType: file.type || undefined });
        if (uploadError) throw new Error("Could not upload " + file.name + ".");
        uploaded.push({ path: target.path, originalName: file.name });
      }
      setFiles((current) => [...current, ...uploaded]);
      setMessage(uploaded.length + " mockup file" + (uploaded.length === 1 ? "" : "s") + " ready. Only these files will be sent.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not upload mockups."); }
    finally { setWorking(false); }
  }

  async function send() {
    if (!files.length) { setError("Upload at least one finished mockup to send."); return; }
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/admin/mockup-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, recipientEmail: email, note, files }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not send mockup review.");
      setFiles([]);
      setMessage("Mockup review sent to " + result.sent + " recipient" + (result.sent === 1 ? "" : "s") + ". It is now saved below as proof history.");
      await loadHistory();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not send mockup review."); }
    finally { setWorking(false); }
  }

  return <section className="mockupReviewControl">
    <div><span className="eyebrow">Before pricing</span><h5>Send selected mockups for review</h5><p>Upload only the polished proof images you want {customerName} to see. Every sent set is permanently saved below, with its approval status.</p></div>
    <label className="btn secondary">{working ? "Working…" : "Upload finished mockups"}<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple hidden disabled={working} onChange={(event) => void choose(event.target.files)} /></label>
    {files.length ? <div className="mockupReviewFiles">{files.map((file, index) => <span key={file.path}>{file.originalName}<button type="button" aria-label={"Remove " + file.originalName} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>×</button></span>)}</div> : <small className="muted">No new mockups selected yet.</small>}
    <label className="field"><span>Message to customer</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
    <div className="mockupReviewActions"><input value={email} onChange={(event) => setEmail(event.target.value)} aria-label="Mockup review recipient" placeholder="customer@example.com"/><button className="btn" type="button" disabled={working} onClick={() => void send()}>{working ? "Sending…" : "Send mockups for review"}</button></div>
    <small>When an open employee roster exists, this email also includes its printable PDF and digital fill-out link.</small>
    {history.length ? <div className="mockupReviewHistory"><strong>Sent mockup history</strong>{history.map((review) => <article key={review.id} className={"mockupReviewHistoryItem " + (review.approved_at ? "isApproved" : "")}><div><span className="eyebrow">{"Proof " + review.version}</span><strong>{review.approved_at ? "Approved by customer" : "Awaiting customer approval"}</strong><small>Sent {dateTime(review.sent_at)} to {review.recipient_emails.join(", ")}</small>{review.approved_at ? <small>Approved {dateTime(review.approved_at)}</small> : null}</div><div className="mockupReviewHistoryFiles">{review.files.map((file) => file.url ? <a key={file.path} href={file.url} target="_blank" rel="noreferrer">View {file.originalName}</a> : <span key={file.path}>{file.originalName}</span>)}</div></article>)}</div> : null}
    {message ? <div className="formSuccess">{message}</div> : null}
    {error ? <div className="formError">{error}</div> : null}
  </section>;
}
