"use client";

import { useState } from "react";

const labels: Record<string, string> = {
  not_reviewed: "Not reviewed",
  customer_attested: "Customer authorization on file",
  permission_requested: "Permission requested — hold production",
  verified: "Permission verified",
  declined: "Declined — do not reproduce",
};

export function ArtworkRightsControl({
  requestId,
  hasArtwork,
  accepted,
  acceptedAt,
  policyVersion,
  initialStatus,
  initialNote,
}: {
  requestId: string;
  hasArtwork: boolean;
  accepted: boolean;
  acceptedAt: string | null;
  policyVersion: string | null;
  initialStatus: string;
  initialNote: string | null;
}) {
  const [status, setStatus] = useState(initialStatus || (accepted ? "customer_attested" : "not_reviewed"));
  const [note, setNote] = useState(initialNote || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save() {
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/artwork-rights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, status, note }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save artwork review.");
      setMessage("Artwork-rights review saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save artwork review.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="artworkRightsAdminCard">
      <div className="artworkRightsAdminHead">
        <div><span className="eyebrow">Artwork rights</span><strong>{hasArtwork ? "Customer-supplied artwork" : "No uploaded artwork"}</strong></div>
        <span className={`artworkRightsStatus is-${status}`}>{labels[status] || status}</span>
      </div>
      <p>{accepted
        ? <>Customer confirmed they own or have permission to reproduce the material they supplied{acceptedAt ? ` on ${new Date(acceptedAt).toLocaleString("en-US")}` : ""}. {policyVersion ? `Policy ${policyVersion}.` : ""}</>
        : hasArtwork
          ? <>No recorded upload authorization is on file for this older request. Review the artwork before production and request permission if anything is questionable.</>
          : <>No customer artwork upload was attached to this request.</>}
      </p>
      <div className="artworkRightsAdminControls">
        <label className="field"><span>Admin review</span><select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="not_reviewed">Not reviewed</option>
          <option value="customer_attested">Customer authorization on file</option>
          <option value="permission_requested">Request proof of permission / hold</option>
          <option value="verified">Permission verified</option>
          <option value="declined">Decline artwork</option>
        </select></label>
        <label className="field"><span>Internal note <small>Optional</small></span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={3000} placeholder="Example: Customer is the business owner; logo matches their company. Or: Asked for written authorization before production." /></label>
      </div>
      <div className="artworkRightsAdminFoot"><span>Moore Made can pause or refuse artwork that appears unauthorized even when a customer checked the authorization box.</span><button className="btn secondary" type="button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save artwork review"}</button></div>
      {message ? <div className="formSuccess">{message}</div> : null}
      {error ? <div className="formError">{error}</div> : null}
    </section>
  );
}
