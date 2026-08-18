"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { clearGuestShowcaseDraft, loadGuestShowcaseDraft, saveGuestShowcaseDraft } from "@/lib/showcase-guest-draft";

const BUCKET = "showcase-files";

export function ShowcaseSubmitForm({ canSaveDraft = false, defaultEmail = "" }: { canSaveDraft?: boolean; defaultEmail?: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState<"draft"|"submit"|"signin"|null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<"draft"|"submit"|null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (!canSaveDraft || !formRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const saved = await loadGuestShowcaseDraft();
        if (!saved || cancelled || !formRef.current) return;
        const form = formRef.current;
        const setValue = (name: string, value: string) => {
          const input = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
          if (input) input.value = value;
        };
        setValue("name", saved.fields.name);
        setValue("businessName", saved.fields.businessName);
        setValue("email", saved.fields.email || defaultEmail);
        setValue("product", saved.fields.product);
        setValue("rating", saved.fields.rating || "5");
        setValue("review", saved.fields.review);
        setValue("caption", saved.fields.caption);
        setValue("socialHandle", saved.fields.socialHandle);
        const permission = form.elements.namedItem("permission") as HTMLInputElement | null;
        if (permission) permission.checked = saved.fields.permission;
        setSelectedFiles(saved.files ?? []);
        setRestored(true);
      } catch {
        // A local restoration failure should never block the review form.
      }
    })();
    return () => { cancelled = true; };
  }, [canSaveDraft, defaultEmail]);

  function captureFields(form: HTMLFormElement) {
    const formData = new FormData(form);
    return {
      name: String(formData.get("name") ?? ""),
      businessName: String(formData.get("businessName") ?? ""),
      email: String(formData.get("email") ?? ""),
      product: String(formData.get("product") ?? ""),
      rating: String(formData.get("rating") ?? "5"),
      review: String(formData.get("review") ?? ""),
      caption: String(formData.get("caption") ?? ""),
      socialHandle: String(formData.get("socialHandle") ?? ""),
      permission: formData.get("permission") === "on",
    };
  }

  async function signInAndPreserve() {
    const form = formRef.current;
    if (!form) return;
    setSubmitting("signin");
    setError("");
    try {
      await saveGuestShowcaseDraft({ savedAt: Date.now(), fields: captureFields(form), files: selectedFiles });
      window.location.href = "/account/login?next=/made-by-you/submit";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not preserve your review before sign-in.");
      setSubmitting(null);
    }
  }

  async function save(form: HTMLFormElement, action: "draft"|"submit") {
    setSubmitting(action); setError(""); setSuccess(null);
    const formData = new FormData(form);
    const files = selectedFiles;
    try {
      const response = await fetch("/api/showcase", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({
        action, name:formData.get("name"), businessName:formData.get("businessName"), email:formData.get("email"), product:formData.get("product"), rating:formData.get("rating"), review:formData.get("review"), caption:formData.get("caption"), socialHandle:formData.get("socialHandle"), permission:formData.get("permission")==="on", website:formData.get("website"), files:files.map(file=>({name:file.name,size:file.size,type:file.type})),
      }) });
      const result = await response.json(); if(!response.ok) throw new Error(result.error||"Could not save your post.");
      const uploadedPaths:string[]=[];
      if(files.length && Array.isArray(result.uploads)){
        const supabase=getSupabaseBrowser();
        for(const target of result.uploads){ const file=files[target.index]; if(!file) continue; const {error:uploadError}=await supabase.storage.from(BUCKET).uploadToSignedUrl(target.path,target.token,file,{contentType:file.type||undefined}); if(!uploadError) uploadedPaths.push(target.path); }
      }
      if(result.id && result.submissionToken){ await fetch(`/api/showcase/${result.id}/files`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({submissionToken:result.submissionToken,paths:uploadedPaths})}); }
      await clearGuestShowcaseDraft().catch(()=>{});
      if(action==="draft" && result.id){ router.push(`/account/made-by-you/${result.id}`); router.refresh(); return; }
      form.reset(); setSelectedFiles([]); setSuccess("submit"); window.scrollTo({top:0,behavior:"smooth"});
    } catch(e){ setError(e instanceof Error?e.message:"Could not save your post."); }
    finally{ setSubmitting(null); }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>){ event.preventDefault(); void save(event.currentTarget,"submit"); }

  if(success==="submit") return <div className="card showcaseSuccess" role="status"><div className="successMark">✓</div><div className="eyebrow">Sent for approval</div><h2>Thanks for sharing what we made together.</h2><p>Your post is waiting for Moore Made approval. Once approved, it can appear in Made by You.</p><button className="btn" type="button" onClick={()=>setSuccess(null)}>Share another project</button></div>;

  return <form ref={formRef} className="form card showcaseForm" onSubmit={onSubmit}>
    <div className="honeypotField" aria-hidden="true"><label htmlFor="website">Website</label><input id="website" name="website" tabIndex={-1} autoComplete="off"/></div>
    {canSaveDraft ? <div className="requestNote"><strong>Need more time?</strong> Save this as a private draft and finish it later from your account.{restored ? <><br/><strong>Your review was restored after sign-in.</strong></> : null}</div> : <div className="requestNote reviewSignInNote"><div><strong>Need more time?</strong><br/>Sign in and save this as a private draft. We’ll keep what you’ve already entered — including the photos you selected — and restore it after sign-in.</div><button className="btn secondary reviewSignInButton" type="button" disabled={!!submitting} onClick={()=>void signInAndPreserve()}>{submitting==="signin"?"Saving your progress...":"Sign in to save"}</button></div>}
    <div className="twoCol"><div className="field"><label htmlFor="name">Your name *</label><input id="name" name="name"/></div><div className="field"><label htmlFor="businessName">Business / organization</label><input id="businessName" name="businessName" placeholder="Optional"/></div></div>
    <div className="twoCol"><div className="field"><label htmlFor="email">Email *</label><input id="email" name="email" type="email" defaultValue={defaultEmail}/><span className="fieldHelp">For approval questions only. It will not be shown publicly.</span></div><div className="field"><label htmlFor="product">What did we make? *</label><input id="product" name="product" placeholder="Work shirts, mugs, wedding favors..."/></div></div>
    <div className="field"><label htmlFor="rating">Your rating *</label><select id="rating" name="rating" defaultValue="5">{[5,4,3,2,1].map(n=><option key={n} value={n}>{"★".repeat(n)}{"☆".repeat(5-n)} — {n} star{n===1?"":"s"}</option>)}</select></div>
    <div className="field"><label htmlFor="review">Your review *</label><textarea id="review" name="review" placeholder="How did everything turn out?"/></div>
    <div className="field"><label htmlFor="caption">Anything you want to say about the photos?</label><textarea id="caption" name="caption" placeholder="Event details, what the order was for, etc."/></div>
    <div className="field"><label htmlFor="photos">Upload project photos <span className="optionalLabel">Optional</span></label><input id="photos" name="photos" type="file" accept="image/*" multiple onChange={(event)=>setSelectedFiles(Array.from(event.currentTarget.files ?? []))}/><span className="fieldHelp">Share up to 5 images, 15 MB each, or submit your review without photos.</span>{selectedFiles.length ? <div className="reviewSelectedFiles"><strong>{selectedFiles.length} photo{selectedFiles.length===1?"":"s"} ready</strong>{selectedFiles.map((file,index)=><span key={`${file.name}-${file.lastModified}-${index}`}>{file.name}</span>)}</div> : null}</div>
    <div className="field"><label htmlFor="socialHandle">Instagram / TikTok handle</label><input id="socialHandle" name="socialHandle" placeholder="Optional — example: @yourbusiness"/></div>
    <label className="consentBox"><input type="checkbox" name="permission"/><span>I give Moore Made permission to display my review, name/business name, and any photos I choose to submit on the Moore Made website and related business social media. I understand the post will be reviewed before it is published.</span></label>
    {error?<div className="formError">{error}</div>:null}
    <div className="reviewEditorActions">{canSaveDraft?<button className="btn secondary" type="button" disabled={!!submitting} onClick={(e)=>{const form=e.currentTarget.form;if(form) void save(form,"draft");}}>{submitting==="draft"?"Saving...":"Save draft"}</button>:null}<button className="btn" type="submit" disabled={!!submitting}>{submitting==="submit"?"Submitting...":"Submit for approval"}</button></div>
  </form>;
}
