"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { DEFAULT_SHOWCASE_PHOTO_PREVIEW, type ShowcasePhotoPreview } from "@/lib/showcase-photo-preview";

type PhotoLink = { path: string; url: string; preview: ShowcasePhotoPreview };

type Props = {
  postId: string;
  initialPhotos: PhotoLink[];
};

const BUCKET = "showcase-files";
const MAX_PHOTOS = 5;

export function ShowcasePhotoManager({ postId, initialPhotos }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const touchStartX = useRef<number | null>(null);
  const [photos, setPhotos] = useState(initialPhotos);
  const [activeIndex, setActiveIndex] = useState(0);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingPreview, setSavingPreview] = useState(false);
  const [previewDraft, setPreviewDraft] = useState<ShowcasePhotoPreview>({ ...DEFAULT_SHOWCASE_PHOTO_PREVIEW });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const remaining = Math.max(0, MAX_PHOTOS - photos.length);
  const activePhoto = photos[activeIndex] ?? null;

  useEffect(() => {
    if (!photos.length) setActiveIndex(0);
    else if (activeIndex > photos.length - 1) setActiveIndex(photos.length - 1);
  }, [photos.length, activeIndex]);

  useEffect(() => {
    setPreviewDraft(activePhoto?.preview ?? { ...DEFAULT_SHOWCASE_PHOTO_PREVIEW });
  }, [activePhoto?.path]);

  function move(direction: -1 | 1) {
    if (photos.length < 2) return;
    setActiveIndex((current) => (current + direction + photos.length) % photos.length);
  }

  function setFocalPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
    setPreviewDraft((current) => ({ ...current, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }));
  }

  async function savePreview() {
    if (!activePhoto) return;
    setSavingPreview(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/showcase-photo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: postId, path: activePhoto.path, preview: previewDraft }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the preview framing.");
      const saved = data.preview as ShowcasePhotoPreview;
      setPhotos((current) => current.map((photo) => photo.path === activePhoto.path ? { ...photo, preview: saved } : photo));
      setPreviewDraft(saved);
      setNotice(`Preview framing saved for photo ${activeIndex + 1}.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the preview framing.");
    } finally {
      setSavingPreview(false);
    }
  }

  async function removePhoto(path: string) {
    if (!window.confirm("Remove only this photo from the review? The review itself will stay intact.")) return;
    setBusyPath(path);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/showcase-photo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: postId, path }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not remove the photo.");
      setPhotos((current) => current.filter((photo) => photo.path !== path));
      setNotice(data.warning || "Photo removed. The review itself was not changed.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the photo.");
    } finally {
      setBusyPath(null);
    }
  }

  async function addPhotos(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/showcase-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: postId, files: files.map((file) => ({ name: file.name, size: file.size, type: file.type })) }),
      });
      const prepared = await response.json();
      if (!response.ok) throw new Error(prepared.error || "Could not prepare the photo upload.");

      const uploadedPaths: string[] = [];
      const supabase = getSupabaseBrowser();
      for (const target of prepared.uploads ?? []) {
        const file = files[target.index];
        if (!file) continue;
        const { error: uploadError } = await supabase.storage.from(BUCKET).uploadToSignedUrl(target.path, target.token, file, { contentType: file.type || undefined });
        if (uploadError) throw new Error(`Could not upload ${file.name}.`);
        uploadedPaths.push(target.path);
      }

      const finalize = await fetch("/api/admin/showcase-photo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: postId, paths: uploadedPaths }),
      });
      const finalized = await finalize.json();
      if (!finalize.ok) throw new Error(finalized.error || "Could not attach the uploaded photos.");
      if (Array.isArray(finalized.photoLinks)) {
        setPhotos(finalized.photoLinks);
        setActiveIndex(Math.max(0, finalized.photoLinks.length - uploadedPaths.length));
      }
      setNotice(`${uploadedPaths.length} photo${uploadedPaths.length === 1 ? "" : "s"} added.`);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the photos.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="showcasePhotoManager">
      <div className="showcasePhotoManagerHeading">
        <div>
          <strong>Review photos</strong>
          <span>{photos.length} of {MAX_PHOTOS} attached · photos are optional</span>
        </div>
        {remaining > 0 ? (
          <label className={`btn secondary showcasePhotoAdd ${uploading ? "isDisabled" : ""}`}>
            {uploading ? "Uploading..." : "+ Add photos"}
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" multiple disabled={uploading} onChange={(event) => addPhotos((Array.from(event.currentTarget.files ?? []) as File[]).slice(0, remaining))} />
          </label>
        ) : null}
      </div>

      {activePhoto ? (
        <div className="showcaseAdminGallery">
          <div
            className="showcaseAdminStage"
            tabIndex={photos.length > 1 ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") move(-1);
              if (event.key === "ArrowRight") move(1);
            }}
            onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }}
            onTouchEnd={(event) => {
              const start = touchStartX.current;
              const end = event.changedTouches[0]?.clientX;
              touchStartX.current = null;
              if (start == null || end == null || Math.abs(end - start) < 45) return;
              move(end < start ? 1 : -1);
            }}
          >
            <img className="showcaseAdminBackdrop" src={activePhoto.url} alt="" aria-hidden="true" />
            <a href={activePhoto.url} target="_blank" rel="noreferrer" aria-label={`Open review photo ${activeIndex + 1} full size`}>
              <img className="showcaseAdminImage" src={activePhoto.url} alt={`Customer submitted project photo ${activeIndex + 1}`} />
            </a>

            {photos.length > 1 ? <>
              <button className="showcaseGalleryArrow isPrevious" type="button" onClick={() => move(-1)} aria-label="Previous review photo">‹</button>
              <button className="showcaseGalleryArrow isNext" type="button" onClick={() => move(1)} aria-label="Next review photo">›</button>
            </> : null}

            <span className="showcaseGalleryCount">Photo {activeIndex + 1} / {photos.length}</span>
            <button
              className="showcasePhotoRemove showcasePhotoRemoveOverlay"
              type="button"
              onClick={() => removePhoto(activePhoto.path)}
              disabled={busyPath === activePhoto.path || uploading}
              aria-label={`Remove photo ${activeIndex + 1}`}
            >
              {busyPath === activePhoto.path ? "Removing..." : "Remove this photo"}
            </button>
          </div>

          {photos.length > 1 ? (
            <div className="showcaseAdminThumbs" aria-label="Choose a review photo">
              {photos.map((photo, index) => (
                <button key={photo.path} type="button" className={index === activeIndex ? "isActive" : ""} onClick={() => setActiveIndex(index)} aria-label={`View photo ${index + 1}`}>
                  <img
                    src={photo.url}
                    alt=""
                    style={{ objectPosition: `${photo.preview.x}% ${photo.preview.y}%`, transform: `scale(${photo.preview.zoom})`, transformOrigin: `${photo.preview.x}% ${photo.preview.y}%` }}
                  />
                  <span>{index + 1}</span>
                </button>
              ))}
            </div>
          ) : null}

          <section className="showcasePreviewEditor" aria-label={`Preview framing for photo ${activeIndex + 1}`}>
            <div className="showcasePreviewEditorHeading">
              <div>
                <strong>Main-page preview</strong>
                <span>Choose how this photo is framed in compact review cards. The full photo is never changed.</span>
              </div>
              <span className="showcasePreviewSavedState">Photo {activeIndex + 1}</span>
            </div>

            <div
              className="showcasePreviewStage"
              onPointerDown={setFocalPoint}
              role="application"
              aria-label="Click or tap the part of the photo you want centered in the compact preview"
            >
              <img
                src={activePhoto.url}
                alt={`Compact homepage preview for photo ${activeIndex + 1}`}
                draggable={false}
                style={{ objectPosition: `${previewDraft.x}% ${previewDraft.y}%`, transform: `scale(${previewDraft.zoom})`, transformOrigin: `${previewDraft.x}% ${previewDraft.y}%` }}
              />
              <span className="showcasePreviewTarget" style={{ left: `${previewDraft.x}%`, top: `${previewDraft.y}%` }} aria-hidden="true" />
              <span className="showcasePreviewHint">Click or tap where you want the preview centered</span>
            </div>

            <div className="showcasePreviewControls">
              <label>
                <span>Horizontal</span>
                <input type="range" min="0" max="100" step="1" value={previewDraft.x} onChange={(event) => setPreviewDraft((current) => ({ ...current, x: Number(event.currentTarget.value) }))} />
              </label>
              <label>
                <span>Vertical</span>
                <input type="range" min="0" max="100" step="1" value={previewDraft.y} onChange={(event) => setPreviewDraft((current) => ({ ...current, y: Number(event.currentTarget.value) }))} />
              </label>
              <label>
                <span>Zoom</span>
                <input type="range" min="1" max="2.25" step="0.05" value={previewDraft.zoom} onChange={(event) => setPreviewDraft((current) => ({ ...current, zoom: Number(event.currentTarget.value) }))} />
              </label>
            </div>

            <div className="showcasePreviewActions">
              <button type="button" className="btn secondary" onClick={() => setPreviewDraft({ ...DEFAULT_SHOWCASE_PHOTO_PREVIEW })} disabled={savingPreview}>Reset center</button>
              <button type="button" className="btn" onClick={savePreview} disabled={savingPreview}>{savingPreview ? "Saving..." : "Save preview framing"}</button>
            </div>
            <p className="fieldHelp">This saved framing is reused automatically anywhere Moore Made shows this photo in a cropped thumbnail. The large review page and popup continue to show the full original image.</p>
          </section>

          <div className="showcaseCurrentPhotoActions">
            <span className="fieldHelp">Select a thumbnail or use ← → / swipe to inspect every photo. Tap the large image for full size.</span>
            {remaining === 0 ? <span className="fieldHelp">Remove a photo before adding another.</span> : null}
          </div>
        </div>
      ) : (
        <div className="showcaseNoPhotos"><strong>No photos attached.</strong><span>This review can still be approved and published without a photo.</span></div>
      )}

      <div className="fieldHelp">PNG, JPG, WEBP, HEIC/HEIF · up to 15 MB each. Removing a photo never deletes the review.</div>
      {error ? <div className="formError showcasePhotoFeedback">{error}</div> : null}
      {notice ? <div className="quoteSuccess showcasePhotoFeedback">{notice}</div> : null}
    </div>
  );
}
