"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

const BUCKET = "finished-product-files";
const MAX_PHOTOS = 12;

type PhotoRow = {
  id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  sort_order: number;
  created_at: string;
  url: string;
};

type LogRow = {
  id: string;
  recipient_email: string;
  subject: string;
  status: "sent" | "failed";
  error_message: string | null;
  sent_at: string;
};

type Props = {
  requestId: string;
  requestNumber: string;
  customerEmail: string;
};

function localDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export function FinishedProductPhotosManager({ requestId, requestNumber, customerEmail }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [galleryUrl, setGalleryUrl] = useState("");
  const [recipientEmails, setRecipientEmails] = useState(customerEmail);
  const [note, setNote] = useState("");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const response = await fetch(`/api/admin/finished-product-photos?requestId=${encodeURIComponent(requestId)}`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not load finished product photos.");
      setPhotos(Array.isArray(result.photos) ? result.photos : []);
      setGalleryUrl(typeof result.galleryUrl === "string" ? result.galleryUrl : "");
      setLogs(Array.isArray(result.logs) ? result.logs : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load finished product photos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [requestId]);

  async function addPhotos(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const chosen = files.slice(0, Math.max(0, MAX_PHOTOS - photos.length));
      const response = await fetch("/api/admin/finished-product-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          action: "prepare_uploads",
          files: chosen.map((file) => ({ name: file.name, size: file.size, type: file.type })),
        }),
      });
      const prepared = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(prepared.error || "Could not prepare the photo upload.");

      const uploaded: Array<{ path: string; name: string; type: string; size: number }> = [];
      const supabase = getSupabaseBrowser();
      for (const target of prepared.uploads ?? []) {
        const file = chosen[target.index];
        if (!file) continue;
        const { error: uploadError } = await supabase.storage.from(BUCKET).uploadToSignedUrl(
          target.path,
          target.token,
          file,
          { contentType: file.type || undefined }
        );
        if (uploadError) throw new Error(`Could not upload ${file.name}.`);
        uploaded.push({ path: target.path, name: file.name, type: file.type, size: file.size });
      }

      const finalize = await fetch("/api/admin/finished-product-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action: "finalize_uploads", items: uploaded }),
      });
      const finalized = await finalize.json().catch(() => ({}));
      if (!finalize.ok) throw new Error(finalized.error || "Could not save the finished product photos.");
      setPhotos(Array.isArray(finalized.photos) ? finalized.photos : []);
      setMessage(`${uploaded.length} finished product photo${uploaded.length === 1 ? "" : "s"} saved. They are now visible in the customer's account.`);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload finished product photos.");
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(photo: PhotoRow) {
    if (!window.confirm(`Remove ${photo.original_filename} from this order?`)) return;
    setRemovingId(photo.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/finished-product-photos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, photoId: photo.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not remove the photo.");
      setPhotos((current) => current.filter((item) => item.id !== photo.id));
      setMessage(result.warning || "Finished product photo removed.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the photo.");
    } finally {
      setRemovingId("");
    }
  }

  async function sendPhotos() {
    if (!photos.length) return setError("Upload at least one finished product photo first.");
    if (!recipientEmails.trim()) return setError("Enter at least one email address.");
    setSending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/finished-product-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action: "send_email", recipientEmails, note }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not send the finished product photos.");
      const sent = Array.isArray(result.sent) ? result.sent : [];
      const failed = Array.isArray(result.failed) ? result.failed : [];
      if (typeof result.galleryUrl === "string") setGalleryUrl(result.galleryUrl);
      setMessage(failed.length
        ? `Photos emailed to ${sent.join(", ")}. ${failed.length} address${failed.length === 1 ? "" : "es"} failed.`
        : `Finished product photos emailed to ${sent.join(", ")}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the finished product photos.");
    } finally {
      setSending(false);
    }
  }

  async function copyGalleryLink() {
    if (!galleryUrl) return;
    try {
      await navigator.clipboard.writeText(galleryUrl);
      setMessage("Private finished-photo link copied.");
    } catch {
      setError("Could not copy the link automatically. Open the gallery and copy it from the browser.");
    }
  }

  const remaining = Math.max(0, MAX_PHOTOS - photos.length);

  return (
    <div className="finishedProductPhotosManager">
      <div className="finishedPhotoHeading">
        <div>
          <strong>Finished product photos</strong>
          <span>Upload the actual completed order. Saved photos appear in the customer's account automatically.</span>
        </div>
        {remaining > 0 ? <label className={`btn secondary finishedPhotoUpload ${uploading ? "isDisabled" : ""}`}>
          {uploading ? "Uploading…" : "+ Upload finished photos"}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
            multiple
            disabled={uploading}
            onChange={(event) => void addPhotos(Array.from(event.currentTarget.files ?? []))}
          />
        </label> : null}
      </div>

      {loading ? <p className="muted">Loading finished photos…</p> : null}

      {photos.length ? <div className="finishedPhotoGrid">
        {photos.map((photo, index) => <div className="finishedPhotoCard" key={photo.id}>
          <a href={photo.url} target="_blank" rel="noreferrer">
            <img src={photo.url} alt={`Finished product photo ${index + 1}`} />
          </a>
          <div><span>Photo {index + 1}</span><small>{photo.original_filename}</small></div>
          <button type="button" onClick={() => void removePhoto(photo)} disabled={removingId === photo.id}>{removingId === photo.id ? "Removing…" : "Remove"}</button>
        </div>)}
      </div> : !loading ? <div className="finishedPhotoEmpty">No finished product photos uploaded yet.</div> : null}

      {photos.length ? <div className="finishedPhotoSendBox">
        <div className="finishedPhotoSendHead">
          <div><strong>Email these photos</strong><span>Send to the customer or any other email address. You can resend this anytime.</span></div>
          {galleryUrl ? <div className="finishedPhotoLinkActions">
            <button className="btn secondary" type="button" onClick={() => void copyGalleryLink()}>Copy private gallery link</button>
            <a className="btn secondary" href={galleryUrl} target="_blank" rel="noreferrer">Open gallery ↗</a>
          </div> : null}
        </div>
        <label className="field"><span>Send to</span><input type="text" inputMode="email" value={recipientEmails} onChange={(event) => setRecipientEmails(event.target.value)} placeholder="customer@example.com" /><small>Comma-separated emails are okay.</small></label>
        <label className="field"><span>Optional message</span><textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="Your order is finished! Here are a few photos before pickup, local delivery, or shipping." /></label>
        <button className="btn" type="button" disabled={sending} onClick={() => void sendPhotos()}>{sending ? "Sending…" : "Email finished product photos"}</button>
      </div> : null}

      {message ? <div className="formSuccess">{message}</div> : null}
      {error ? <div className="formError">{error}</div> : null}

      {logs.length ? <div className="finishedPhotoHistory">
        <strong>Recent photo emails</strong>
        {logs.slice(0, 6).map((row) => <div key={row.id}><span>{row.recipient_email} · {localDateTime(row.sent_at)}</span><b className={row.status === "sent" ? "notificationSent" : "notificationFailed"}>{row.status === "sent" ? "Sent" : "Failed"}</b></div>)}
      </div> : null}

      <small className="finishedPhotoFootnote">{requestNumber} · Up to {MAX_PHOTOS} photos · 20 MB each.</small>
    </div>
  );
}
