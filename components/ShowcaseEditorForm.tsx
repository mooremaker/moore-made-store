"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

const BUCKET = "showcase-files";
type PhotoLink = { path: string; url: string };
type Initial = { id:string; name:string; businessName:string; email:string; product:string; rating:number; review:string; caption:string; socialHandle:string; permission:boolean; status:string; hadPublishedVersion:boolean; photos:PhotoLink[]; };

export function ShowcaseEditorForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [photos,setPhotos] = useState<PhotoLink[]>(initial.photos);
  const [busy,setBusy] = useState<"draft"|"submit"|"delete"|null>(null);
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");
  const maxNew = useMemo(() => Math.max(0,5-photos.length),[photos.length]);

  async function save(formEl: HTMLFormElement, action: "draft"|"submit") {
    setBusy(action); setError(""); setMessage("");
    const data = new FormData(formEl);
    const input = formEl.elements.namedItem("photos") as HTMLInputElement | null;
    const files = Array.from(input?.files ?? []);
    try {
      if (files.length > maxNew) throw new Error(`You can add ${maxNew} more photo${maxNew===1?"":"s"}.`);
      const payload = { action, name:data.get("name"), businessName:data.get("businessName"), email:data.get("email"), product:data.get("product"), rating:data.get("rating"), review:data.get("review"), caption:data.get("caption"), socialHandle:data.get("socialHandle"), permission:data.get("permission")==="on", keepPaths:photos.map(p=>p.path), newFiles:files.map(f=>({name:f.name,size:f.size,type:f.type})) };
      const saveRes = await fetch(`/api/showcase/${initial.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const saveJson = await saveRes.json(); if(!saveRes.ok) throw new Error(saveJson.error||"Could not save your review.");
      if(files.length){
        const prep=await fetch(`/api/showcase/${initial.id}/photos`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({files:files.map(f=>({name:f.name,size:f.size,type:f.type}))})});
        const pj=await prep.json(); if(!prep.ok) throw new Error(pj.error||"Could not prepare your photo upload.");
        const uploaded:string[]=[]; const supabase=getSupabaseBrowser();
        for(const target of pj.uploads??[]){ const file=files[target.index]; if(!file) continue; const {error:uploadError}=await supabase.storage.from(BUCKET).uploadToSignedUrl(target.path,target.token,file,{contentType:file.type||undefined}); if(uploadError) throw new Error(`Could not upload ${file.name}.`); uploaded.push(target.path); }
        if(uploaded.length){ const attach=await fetch(`/api/showcase/${initial.id}/photos`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({paths:uploaded})}); const aj=await attach.json(); if(!attach.ok) throw new Error(aj.error||"Could not attach your photos."); }
      }
      if(input) input.value="";
      setMessage(action==="submit"?"Submitted for Moore Made approval.":"Draft saved. You can come back anytime.");
      router.refresh(); if(action==="submit") setTimeout(()=>router.push("/account"),600);
    } catch(e){ setError(e instanceof Error?e.message:"Could not save your review."); }
    finally{ setBusy(null); }
  }

  async function deleteReview(){ if(!window.confirm("Delete this review and all of its photos? This cannot be undone.")) return; setBusy("delete"); setError(""); try{ const r=await fetch(`/api/showcase/${initial.id}`,{method:"DELETE"}); const j=await r.json(); if(!r.ok) throw new Error(j.error||"Could not delete your review."); router.push("/account"); router.refresh(); }catch(e){setError(e instanceof Error?e.message:"Could not delete your review.");setBusy(null);} }

  return <form className="form card showcaseForm showcaseEditorForm" onSubmit={(e)=>{e.preventDefault(); void save(e.currentTarget,"submit");}}>
    {initial.hadPublishedVersion && initial.status!=="approved" ? <div className="requestNote"><strong>Your previously approved version stays public.</strong><br/>These edits will not replace it until Moore Made approves the updated version.</div>:null}
    <div className="twoCol"><div className="field"><label>Your name *</label><input name="name" defaultValue={initial.name==="Draft"?"":initial.name}/></div><div className="field"><label>Business / organization</label><input name="businessName" defaultValue={initial.businessName}/></div></div>
    <div className="twoCol"><div className="field"><label>Email *</label><input type="email" name="email" defaultValue={initial.email}/></div><div className="field"><label>What did we make? *</label><input name="product" defaultValue={initial.product==="Untitled review"?"":initial.product}/></div></div>
    <div className="field"><label>Your rating *</label><select name="rating" defaultValue={String(initial.rating)}>{[5,4,3,2,1].map(n=><option key={n} value={n}>{"★".repeat(n)}{"☆".repeat(5-n)} — {n} star{n===1?"":"s"}</option>)}</select></div>
    <div className="field"><label>Your review *</label><textarea name="review" defaultValue={initial.review}/></div>
    <div className="field"><label>Anything you want to say about the photos?</label><textarea name="caption" defaultValue={initial.caption}/></div>
    {photos.length?<div className="customerReviewPhotoGrid">{photos.map((photo,index)=><div key={photo.path} className="customerReviewPhoto"><a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Review photo ${index+1}`}/></a><button type="button" className="textButton dangerText" onClick={()=>setPhotos(items=>items.filter(i=>i.path!==photo.path))}>Remove photo</button></div>)}</div>:<div className="requestNote"><strong>No photos attached.</strong> That&apos;s okay — photos are optional for reviews.</div>}
    <div className="field"><label>Add photos <span className="optionalLabel">Optional</span></label><input name="photos" type="file" accept="image/*" multiple disabled={maxNew===0}/><span className="fieldHelp">Up to 5 total, 15 MB each. {maxNew} slot{maxNew===1?"":"s"} available.</span></div>
    <div className="field"><label>Instagram / TikTok handle</label><input name="socialHandle" defaultValue={initial.socialHandle}/></div>
    <label className="consentBox"><input type="checkbox" name="permission" defaultChecked={initial.permission}/><span>I give Moore Made permission to display my review, name/business name, and any photos I choose to submit on the Moore Made website and related business social media. Updated submissions are reviewed before changes are published.</span></label>
    {error?<div className="formError">{error}</div>:null}{message?<div className="quoteSuccess">{message}</div>:null}
    <div className="reviewEditorActions"><button type="button" className="btn secondary" disabled={!!busy} onClick={(e)=>{const form=e.currentTarget.form;if(form) void save(form,"draft");}}>{busy==="draft"?"Saving...":"Save draft"}</button><button className="btn" type="submit" disabled={!!busy}>{busy==="submit"?"Submitting...":"Submit for approval"}</button><button type="button" className="textButton dangerText" disabled={!!busy} onClick={deleteReview}>{busy==="delete"?"Deleting...":"Delete review"}</button></div>
  </form>;
}
