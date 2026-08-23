"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { SUPPORT_INQUIRY_STATUS_LABELS, type SupportGift, type SupportInquiry, type SupportInquiryStatus, type SupportPageSettings } from "@/lib/support-types";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.max(0, cents) / 100);
}

function localDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(value));
}

function localDateTimeInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type GoalSuggestions = {
  recommendedGoalCents: number;
  goalNames: string[];
  weeklySalesGoalCents: number;
  weeklyProfitGoalCents: number;
  weeklyOwnerGoalCents: number;
  weeklyReserveGoalCents: number;
  suggestedHeadline: string;
  suggestedIntroduction: string;
};

type SupportData = { settings: SupportPageSettings; inquiries: SupportInquiry[]; gifts: SupportGift[]; giftsReady: boolean; totalGiftCents: number; publicBaseUrl: string; goalSuggestions: GoalSuggestions };

export function AdminSupportGiftsPanel() {
  const [data, setData] = useState<SupportData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [headline, setHeadline] = useState("");
  const [introduction, setIntroduction] = useState("");
  const [fundingGoal, setFundingGoal] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const [isLocalAdmin, setIsLocalAdmin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/admin/support", { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) { setError(result.error || "Could not load the support page."); return; }
    setError("");
    setData(result);
    setHeadline(result.settings.headline || "");
    setIntroduction(result.settings.introduction || "");
    setFundingGoal(String(Math.round(Number(result.settings.funding_goal_cents || result.goalSuggestions?.recommendedGoalCents || 0) / 100)));
    setExpiresAt(localDateTimeInput(result.settings.expires_at));
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    setIsLocalAdmin(local);
    if (local && data) setLocalPreviewUrl(`${window.location.origin}/support/${data.settings.access_token}`);
  }, [data]);

  const shareUrl = data ? `${data.publicBaseUrl}/support/${data.settings.access_token}` : "";
  const newCount = useMemo(() => data?.inquiries.filter((row) => row.status === "new").length || 0, [data]);
  const progress = data?.settings.funding_goal_cents ? Math.round(data.totalGiftCents / data.settings.funding_goal_cents * 100) : 0;

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true); setError("");
    const response = await fetch("/api/admin/support", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      enabled: form.get("enabled") === "yes",
      phone: form.get("phone"), contactEmail: form.get("contactEmail"),
      fundingGoalCents: Math.round(Number(form.get("fundingGoal") || 0) * 100),
      expiresAt: form.get("expiresAt") ? new Date(String(form.get("expiresAt"))).toISOString() : "", headline: form.get("headline"), introduction: form.get("introduction"),
    }) });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) { setError(result.error || "Could not save the support page."); return; }
    await load();
  }

  async function rotateLink() {
    if (!window.confirm("Regenerate the private link? The current link will stop working immediately.")) return;
    const response = await fetch("/api/admin/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rotate_token" }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error || "Could not regenerate the link."); return; }
    await load();
  }

  async function reactivateLink() {
    setSaving(true); setError("");
    const response = await fetch("/api/admin/support", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      enabled: true,
      phone: data?.settings.phone,
      contactEmail: data?.settings.contact_email,
      fundingGoalCents: Math.round(Number(fundingGoal || 0) * 100),
      expiresAt: "",
      headline,
      introduction,
    }) });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) { setError(result.error || "Could not reactivate the support link."); return; }
    await load();
  }

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  }

  async function updateInquiry(inquiry: SupportInquiry, status: SupportInquiryStatus, adminNote: string) {
    const response = await fetch("/api/admin/support", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_inquiry", id: inquiry.id, status, adminNote }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error || "Could not update this supporter."); return; }
    await load();
  }

  function fillFromGoals() {
    setHeadline(data?.goalSuggestions.suggestedHeadline || "");
    setIntroduction(data?.goalSuggestions.suggestedIntroduction || "");
    setFundingGoal(String(Math.round((data?.goalSuggestions.recommendedGoalCents || 0) / 100)));
  }

  if (loading) return <section className="adminWorkspacePanel"><div className="empty"><p>Loading the support page…</p></div></section>;
  if (!data) return <section className="adminWorkspacePanel"><div className="formError">{error || "Support gifts are unavailable."}</div><div className="requestNote"><strong>One database step is required.</strong> Run <code>supabase/moore_made_phase6_48_support_gifts_portal.sql</code> in Supabase, then reload this tab.</div></section>;

  const linkExpired = Boolean(data.settings.expires_at && new Date(data.settings.expires_at) <= new Date());

  return <section className="adminWorkspacePanel supportAdminPanel">
    <div className="adminSectionIntro"><div><div className="eyebrow">Private supporter link</div><h2>Support Moore Made</h2><p>Share a simple, grandparent-friendly overview and collect interest. Ready supporters can continue to the separate voluntary-gift form and receive their own secure Stripe link by email.</p></div><span className={`statusBadge ${data.settings.enabled && !linkExpired ? "status-approved" : "status-new"}`}>{linkExpired ? "Link expired" : data.settings.enabled ? "Published" : "Private draft"}</span></div>
    {error ? <div className="formError">{error}</div> : null}
    {linkExpired ? <div className="requestWarning supportExpiredWarning"><div><strong>This is why the shared link shows 404.</strong><span>Its saved expiration was {localDate(data.settings.expires_at!)} Eastern. Clear it to reopen the same private link.</span></div><button className="btn secondary" type="button" disabled={saving} onClick={() => void reactivateLink()}>{saving ? "Reactivating…" : "Reactivate without expiration"}</button></div> : null}

    <div className="supportAdminMetrics"><article><span>Recorded gifts</span><strong>{money(data.totalGiftCents)}</strong></article><article><span>Support goal</span><strong>{data.settings.funding_goal_cents ? money(data.settings.funding_goal_cents) : "Not set"}</strong></article><article><span>Progress</span><strong>{data.settings.funding_goal_cents ? `${progress}%` : "—"}</strong></article><article><span>New interest</span><strong>{newCount}</strong></article></div>

    <section className="supportGiftLedger">
      <div className="financeTableHead"><div><div className="eyebrow">Separate gift ledger</div><h3>Gifts Received</h3><p>Stripe gifts only—never mixed with sales, loans, investments, or owner contributions.</p></div><a className="btn secondary" href="/gift" target="_blank" rel="noreferrer">Open public gift form</a></div>
      {!data.giftsReady ? <div className="requestWarning"><strong>One database step is required.</strong><span>Run <code>supabase/moore_made_phase6_61_voluntary_gifts.sql</code>, then reload.</span></div> : data.gifts.length ? <div className="supportGiftRows">{data.gifts.map((gift) => <article key={gift.id} className="supportGiftRow">
        <div className="supportGiftDonor"><span className={`statusBadge ${gift.status === "paid" ? "status-approved" : "status-new"}`}>{gift.status.replaceAll("_", " ")}</span><strong>{gift.donor_name}</strong><a href={`mailto:${gift.donor_email}`}>{gift.donor_email}</a><small>{localDate(gift.paid_at || gift.created_at)}</small></div>
        <div><span>Gross</span><strong>{gift.gross_amount_cents == null ? "Pending" : money(gift.gross_amount_cents)}</strong></div><div><span>Stripe fee</span><strong>{gift.stripe_fee_cents == null ? "Not synced yet" : money(gift.stripe_fee_cents)}</strong></div><div><span>Net</span><strong>{gift.net_amount_cents == null ? "Pending" : money(gift.net_amount_cents)}</strong></div>
        <details><summary>Payment, note & acknowledgement</summary><p><strong>Payment ID:</strong> {gift.stripe_payment_intent_id || "Not paid yet"}</p><p><strong>Message:</strong> {gift.donor_message || "No message"}</p><p><strong>{gift.acknowledgement_version} accepted {localDate(gift.acknowledged_at)}:</strong> {gift.acknowledgement_text}</p></details>
      </article>)}</div> : <div className="empty"><h3>No Stripe gifts received yet.</h3><p>Submitted links and completed payments will appear here automatically.</p></div>}
    </section>

    <div className="supportAdminEditorGrid">
      <section className="card supportAdminSettings">
        <div className="financePanelHead"><div><div className="eyebrow">Page builder</div><h3>Build the supporter story in three steps.</h3><p>Use the suggested copy as a starting point, then make it sound like Moore Made.</p></div></div>
        <form onSubmit={saveSettings}>
          <section className="supportSettingsStep">
            <div className="supportSettingsStepHead"><span>1</span><div><strong>Story and goals</strong><small>What supporters should understand first</small></div></div>
            <div className="supportGoalAutofill">
              <div className="supportGoalAutofillCopy">
                <div><span className="supportGoalAutofillBadge">Suggested starting point</span><strong>Build this page from your live business goals</strong></div>
                <p className="supportGoalPriorities">{data.goalSuggestions.goalNames.length ? <><b>Current priorities:</b> {data.goalSuggestions.goalNames.join(", ")}.</> : "Add equipment or savings goals in Business & Financials to make this recommendation more specific."}</p>
                <div className="supportGoalAutofillNumbers"><span><small>Support goal</small><b>{money(data.goalSuggestions.recommendedGoalCents)}</b></span><span><small>Weekly sales target</small><b>{money(data.goalSuggestions.weeklySalesGoalCents)}</b></span><span><small>Weekly profit target</small><b>{money(data.goalSuggestions.weeklyProfitGoalCents)}</b></span></div>
                <small className="supportGoalPrivacy">Only public goal names and targets are used. Private costs and notes stay private.</small>
              </div>
              <button className="btn secondary" type="button" onClick={fillFromGoals}>Use current goals</button>
            </div>
            <label className="field"><span>Support-page headline</span><input name="headline" required maxLength={180} value={headline} onChange={(event) => setHeadline(event.target.value)} /></label>
            <label className="field"><span>Short introduction</span><textarea name="introduction" required maxLength={1500} rows={5} value={introduction} onChange={(event) => setIntroduction(event.target.value)} /></label>
          </section>

          <section className="supportSettingsStep">
            <div className="supportSettingsStepHead"><span>2</span><div><strong>Contact and funding goal</strong><small>How supporters can reach Moore Made</small></div></div>
            <div className="twoCol"><label className="field"><span>Moore Made phone</span><input name="phone" type="tel" required={data.settings.enabled} defaultValue={data.settings.phone || ""} placeholder="Required to publish" /></label><label className="field"><span>Moore Made email</span><input name="contactEmail" type="email" required={data.settings.enabled} defaultValue={data.settings.contact_email || ""} placeholder="Required to publish" /></label></div>
            <label className="field"><span>Total support goal</span><input name="fundingGoal" type="number" min="0" step="1" value={fundingGoal} onChange={(event) => setFundingGoal(event.target.value)} /><small>The public page shows progress toward this amount.</small></label>
          </section>

          <section className="supportSettingsStep">
            <div className="supportSettingsStepHead"><span>3</span><div><strong>Access and publishing</strong><small>Control whether the private page is available</small></div></div>
            <label className="financeConfirmCheck supportPublishToggle"><input type="checkbox" name="enabled" value="yes" defaultChecked={data.settings.enabled} /><span><strong>Publish this private link</strong><small>Turn this off instantly to make the link unavailable.</small></span></label>
            <label className="field"><span>Link expiration <small>Optional · leave blank to keep active</small></span><input name="expiresAt" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /><small>Times are saved correctly from your local time. For family supporters, leaving this blank is usually easiest.</small></label>
          </section>
          <div className="supportSaveBar"><span>Save before copying the live link.</span><button className="btn" type="submit" disabled={saving}>{saving ? "Saving…" : "Save support page"}</button></div>
        </form>
      </section>

      <aside className="supportAdminSideColumn">
        <section className="card supportAdminShareCard">
          <div><div className="eyebrow">Share and preview</div><h3>Your private supporter link</h3><p>Copy this only after the live site has the newest deployment.</p></div>
          {isLocalAdmin ? <div className="requestWarning supportDeploymentWarning"><strong>You are editing localhost.</strong><span>Preview locally tests the changes on this computer. Preview live tests what potential supporters currently see on mooremade.store.</span></div> : null}
          <label className="field"><span>Live share link</span><input readOnly value={shareUrl} aria-label="Private support page link" /></label>
          <div className="supportShareActions"><button className="btn" type="button" onClick={copyLink}>{copied ? "Copied ✓" : "Copy live link"}</button>{localPreviewUrl ? <a className="btn secondary supportLocalPreviewButton" href={localPreviewUrl} target="_blank" rel="noopener noreferrer" title="Open the supporter page from this local development site">Preview locally</a> : null}<a className="btn secondary" href={shareUrl} target="_blank" rel="noopener noreferrer">Preview live</a></div>
          <div className="supportLinkSafety"><span>{data.settings.enabled && !linkExpired ? "✓ Published" : "! Not currently available"}</span><small>Excluded from search engines · token protected</small></div>
          <button className="textButton financeDeleteButton" type="button" onClick={rotateLink}>Regenerate link and revoke the old one</button>
        </section>
        <section className="card supportAdminHelpCard"><div className="eyebrow">Before sharing</div><h3>Quick check</h3><ol><li>Save the page.</li><li>Preview locally.</li><li>Deploy the newest website.</li><li>Preview live.</li><li>Copy and send the live link.</li></ol></section>
      </aside>
    </div>

    <section className="supportAdminInbox">
      <div className="financeTableHead"><div><div className="eyebrow">Supporter inbox</div><h3>People who asked MooreMade to follow up</h3></div><span>{data.inquiries.length} total</span></div>
      {data.inquiries.length ? data.inquiries.map((inquiry) => <SupportInquiryCard key={inquiry.id} inquiry={inquiry} onSave={updateInquiry} />) : <div className="empty"><h3>No supporter messages yet.</h3><p>New interest submissions will appear here and notify your admin email.</p></div>}
    </section>
  </section>;
}

function SupportInquiryCard({ inquiry, onSave }: { inquiry: SupportInquiry; onSave: (inquiry: SupportInquiry, status: SupportInquiryStatus, note: string) => Promise<void> }) {
  const [status, setStatus] = useState<SupportInquiryStatus>(inquiry.status);
  const [note, setNote] = useState(inquiry.admin_note || "");
  const [saving, setSaving] = useState(false);
  return <article className={`supportInquiryCard ${inquiry.status === "new" ? "isNew" : ""}`}>
    <div className="supportInquiryHead"><div><span>{inquiry.status === "new" ? "NEW SUPPORT INTEREST" : SUPPORT_INQUIRY_STATUS_LABELS[inquiry.status]}</span><h4>{inquiry.name}</h4><small>{localDate(inquiry.created_at)}</small></div><div className="supportInquiryContact">{inquiry.phone ? <a href={`tel:${inquiry.phone}`}>Call {inquiry.phone}</a> : null}{inquiry.email ? <a href={`mailto:${inquiry.email}`}>Email {inquiry.email}</a> : null}</div></div>
    <div className="supportInquiryDetails"><p><strong>Preferred contact:</strong> {inquiry.preferred_contact}</p><p><strong>Possible amount:</strong> {inquiry.amount_range || "Not specified"}</p>{inquiry.message ? <p><strong>Message:</strong> {inquiry.message}</p> : null}<p><strong>Gift terms:</strong> {inquiry.gift_terms_acknowledged ? "Acknowledged" : "Missing"}</p></div>
    <div className="supportInquiryActions"><select value={status} onChange={(event) => setStatus(event.target.value as SupportInquiryStatus)}>{Object.entries(SUPPORT_INQUIRY_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Private admin note" /><button className="btn secondary" type="button" disabled={saving} onClick={async () => { setSaving(true); await onSave(inquiry, status, note); setSaving(false); }}>{saving ? "Saving…" : "Save"}</button><a className="btn secondary" href={`/admin/support/gift-letter/${inquiry.id}`} target="_blank" rel="noreferrer">Gift letter</a></div>
  </article>;
}
