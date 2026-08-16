"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

const BUCKET = "showcase-files";

export function ShowcaseSubmitForm() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess(false);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const fileInput = form.elements.namedItem("photos") as HTMLInputElement | null;
    const files = Array.from(fileInput?.files ?? []);

    try {
      const response = await fetch("/api/showcase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          businessName: formData.get("businessName"),
          email: formData.get("email"),
          product: formData.get("product"),
          rating: formData.get("rating"),
          review: formData.get("review"),
          caption: formData.get("caption"),
          socialHandle: formData.get("socialHandle"),
          permission: formData.get("permission") === "on",
          website: formData.get("website"),
          files: files.map((file) => ({ name: file.name, size: file.size, type: file.type })),
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not submit your post.");

      const uploadedPaths: string[] = [];
      if (files.length && Array.isArray(result.uploads)) {
        const supabase = getSupabaseBrowser();
        for (const target of result.uploads) {
          const file = files[target.index];
          if (!file) continue;
          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type || undefined });
          if (!uploadError) uploadedPaths.push(target.path);
        }
      }

      if (result.id && result.submissionToken) {
        await fetch(`/api/showcase/${result.id}/files`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submissionToken: result.submissionToken, paths: uploadedPaths }),
        });
      }

      form.reset();
      setSuccess(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit your post.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="card showcaseSuccess" role="status">
        <div className="successMark">✓</div>
        <div className="eyebrow">Sent for approval</div>
        <h2>Thanks for sharing what we made together.</h2>
        <p>Your post is waiting for Moore Made approval. Once approved, it can appear in Made by You.</p>
        <button className="btn" type="button" onClick={() => setSuccess(false)}>Share another project</button>
      </div>
    );
  }

  return (
    <form className="form card showcaseForm" onSubmit={onSubmit}>
      <div className="honeypotField" aria-hidden="true">
        <label htmlFor="website">Website</label><input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="twoCol">
        <div className="field"><label htmlFor="name">Your name *</label><input id="name" name="name" required /></div>
        <div className="field"><label htmlFor="businessName">Business / organization</label><input id="businessName" name="businessName" placeholder="Optional" /></div>
      </div>
      <div className="twoCol">
        <div className="field"><label htmlFor="email">Email *</label><input id="email" name="email" type="email" required /><span className="fieldHelp">For approval questions only. It will not be shown publicly.</span></div>
        <div className="field"><label htmlFor="product">What did we make? *</label><input id="product" name="product" placeholder="Work shirts, mugs, wedding favors..." required /></div>
      </div>

      <div className="field">
        <label htmlFor="rating">Your rating *</label>
        <select id="rating" name="rating" defaultValue="5" required>
          <option value="5">★★★★★ — 5 stars</option><option value="4">★★★★☆ — 4 stars</option><option value="3">★★★☆☆ — 3 stars</option><option value="2">★★☆☆☆ — 2 stars</option><option value="1">★☆☆☆☆ — 1 star</option>
        </select>
      </div>
      <div className="field"><label htmlFor="review">Your review *</label><textarea id="review" name="review" placeholder="How did everything turn out?" required /></div>
      <div className="field"><label htmlFor="caption">Anything you want to say about the photos?</label><textarea id="caption" name="caption" placeholder="Event details, what the order was for, etc." /></div>
      <div className="field"><label htmlFor="photos">Upload your project photos *</label><input id="photos" name="photos" type="file" accept="image/*" multiple required /><span className="fieldHelp">Up to 5 images, 15 MB each.</span></div>
      <div className="field"><label htmlFor="socialHandle">Instagram / TikTok handle</label><input id="socialHandle" name="socialHandle" placeholder="Optional — example: @yourbusiness" /></div>

      <label className="consentBox">
        <input type="checkbox" name="permission" required />
        <span>I give Moore Made permission to display the photos, review, and name/business name I submit on the Moore Made website and related business social media. I understand the post will be reviewed before it is published.</span>
      </label>

      {error ? <div className="formError">{error}</div> : null}
      <button className="btn" type="submit" disabled={submitting}>{submitting ? "Submitting..." : "Submit for approval"}</button>
    </form>
  );
}
