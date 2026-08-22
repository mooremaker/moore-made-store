"use client";

import { useState, type FormEvent } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

const BUCKET = "customer-brand-assets";

export type BusinessLogoAsset = {
  id: string;
  label: string;
  original_filename: string | null;
  production_approved: boolean;
  url: string | null;
};

function normalizeHex(value: string) {
  const raw = value.trim().replace(/^#/, "").replace(/[^0-9a-f]/gi, "").slice(0, 6).toUpperCase();
  return `#${raw}`;
}

export function BusinessProfileForm({
  initialBusinessName = "",
  initialWebsite = "",
  initialColors = [],
  initialNotes = "",
  initialLogos = [],
}: {
  initialBusinessName?: string;
  initialWebsite?: string;
  initialColors?: string[];
  initialNotes?: string;
  initialLogos?: BusinessLogoAsset[];
}) {
  const [businessName, setBusinessName] = useState(initialBusinessName);
  const [website, setWebsite] = useState(initialWebsite);
  const [brandColors, setBrandColors] = useState(initialColors.length ? initialColors : ["#000000"]);
  const [brandNotes, setBrandNotes] = useState(initialNotes);
  const [logos, setLogos] = useState(initialLogos);
  const [logoLabel, setLogoLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function patchColor(index: number, value: string) {
    setBrandColors((current) => current.map((color, colorIndex) => colorIndex === index ? normalizeHex(value) : color));
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validColors = brandColors.map(normalizeHex).filter((color) => /^#[0-9A-F]{6}$/.test(color));
    setSaving(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/account/business-profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessName, website, brandColors: validColors, brandNotes }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save your business profile.");
      setBrandColors(validColors.length ? validColors : ["#000000"]);
      setMessage("Business profile saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your business profile.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setUploading(true); setMessage(""); setError("");
    try {
      const prepareResponse = await fetch("/api/account/business-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare_logo", name: file.name, size: file.size, type: file.type }) });
      const prepared = await prepareResponse.json();
      if (!prepareResponse.ok) throw new Error(prepared.error || "Could not prepare the logo upload.");
      const { path, token } = prepared.target || {};
      if (!path || !token) throw new Error("Could not prepare the logo upload.");
      const { error: uploadError } = await getSupabaseBrowser().storage.from(BUCKET).uploadToSignedUrl(path, token, file, { contentType: file.type || undefined });
      if (uploadError) throw new Error("Could not upload this logo. Please try again.");
      const finishResponse = await fetch("/api/account/business-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "finish_logo", path, originalName: file.name, label: logoLabel.trim() || file.name.replace(/\.[^.]+$/, "") }) });
      const finished = await finishResponse.json();
      if (!finishResponse.ok) throw new Error(finished.error || "Could not save this logo.");
      setLogos((current) => [finished.asset, ...current]);
      setLogoLabel("");
      setMessage("Logo saved to your business profile.");
    } catch (uploadFailure) {
      setError(uploadFailure instanceof Error ? uploadFailure.message : "Could not save this logo.");
    } finally {
      setUploading(false);
    }
  }

  async function deleteLogo(asset: BusinessLogoAsset) {
    if (!window.confirm(`Delete “${asset.label}” from your business profile?`)) return;
    setError(""); setMessage("");
    const response = await fetch("/api/account/business-profile", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId: asset.id }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error || "Could not delete this logo."); return; }
    setLogos((current) => current.filter((logo) => logo.id !== asset.id));
    setMessage("Logo deleted.");
  }

  return (
    <div className="businessProfileEditor">
      <form className="businessProfileForm" onSubmit={saveProfile}>
        <div className="twoCol">
          <label className="field"><span>Business / organization name</span><input value={businessName} onChange={(event) => setBusinessName(event.target.value)} maxLength={180} placeholder="Example: Smith Family Farm" /></label>
          <label className="field"><span>Website or social page <small>Optional</small></span><input value={website} onChange={(event) => setWebsite(event.target.value)} maxLength={300} placeholder="https://…" /></label>
        </div>
        <div className="businessBrandColors">
          <div><strong>Brand colors</strong><span>Use exact six-digit hex codes when you know them.</span></div>
          <div className="businessBrandColorList">{brandColors.map((color, index) => <div className="businessBrandColor" key={index}><input type="color" value={/^#[0-9A-F]{6}$/.test(color) ? color : "#000000"} onChange={(event) => patchColor(index, event.target.value)} aria-label={`Choose brand color ${index + 1}`} /><input value={color} onChange={(event) => patchColor(index, event.target.value)} maxLength={7} aria-label={`Hex code for brand color ${index + 1}`} placeholder="#000000" /><button type="button" onClick={() => setBrandColors((current) => current.filter((_, colorIndex) => colorIndex !== index))} disabled={brandColors.length === 1}>Remove</button></div>)}</div>
          {brandColors.length < 8 ? <button className="btn secondary businessAddColor" type="button" onClick={() => setBrandColors((current) => [...current, "#FFFFFF"])}>+ Add another color</button> : null}
        </div>
        <label className="field"><span>Brand notes <small>Optional</small></span><textarea value={brandNotes} onChange={(event) => setBrandNotes(event.target.value)} maxLength={3000} placeholder="Preferred fonts, colors to avoid, slogan wording, or anything Moore Made should remember for future orders." /></label>
        <div className="accountProfileActions"><button className="btn" type="submit" disabled={saving}>{saving ? "Saving…" : "Save business profile"}</button></div>
      </form>

      <section className="businessLogoSection">
        <div className="businessLogoHead"><div><strong>Saved logos</strong><span>Upload once, then tell Moore Made which saved logo to use on future requests.</span></div><small>PNG or SVG is best · PDF and JPG accepted · 20 MB max</small></div>
        <div className="businessLogoUpload"><label className="field"><span>Logo name <small>Optional</small></span><input value={logoLabel} onChange={(event) => setLogoLabel(event.target.value)} maxLength={180} placeholder="Example: Primary full-color logo" /></label><label className={`btn secondary businessLogoUploadButton ${uploading ? "isDisabled" : ""}`}>{uploading ? "Uploading…" : "+ Upload a logo"}<input type="file" hidden disabled={uploading} accept="image/*,.svg,.pdf" onChange={(event) => { void uploadLogo(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>
        {logos.length ? <div className="businessLogoGrid">{logos.map((logo) => <article key={logo.id}><div className="businessLogoPreview">{logo.url ? <img src={logo.url} alt={logo.label} /> : <span>LOGO</span>}</div><div><strong>{logo.label}</strong><span>{logo.original_filename || "Saved logo"}</span>{logo.production_approved ? <small>Production approved</small> : <small>Moore Made will verify print quality</small>}</div><button type="button" onClick={() => deleteLogo(logo)}>Delete</button></article>)}</div> : <p className="businessLogoEmpty">No logos saved yet.</p>}
      </section>
      {message ? <div className="savedCartMessage" role="status">{message}</div> : null}
      {error ? <div className="formError" role="alert">{error}</div> : null}
    </div>
  );
}
