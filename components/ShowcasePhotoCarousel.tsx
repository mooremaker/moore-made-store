"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRefreshStablePhotoIndex } from "@/lib/showcase-photo-selection";

type Props = {
  photoUrls: string[];
  altBase: string;
  onPhotoClick?: () => void;
  showFullSizeLink?: boolean;
  reviewId?: string;
};

export function ShowcasePhotoCarousel({ photoUrls, altBase, onPhotoClick, showFullSizeLink = false, reviewId = altBase }: Props) {
  const [index, setIndex] = useRefreshStablePhotoIndex(reviewId, photoUrls);
  const [fullViewOpen, setFullViewOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const touchStartX = useRef<number | null>(null);
  const active = index == null ? null : (photoUrls[index] ?? null);

  useEffect(() => {
    if (!photoUrls.length) setIndex(0);
    else if (index != null && index > photoUrls.length - 1) setIndex(photoUrls.length - 1);
  }, [photoUrls.length, index, setIndex]);

  useEffect(() => {
    setZoom(1);
  }, [index]);

  useEffect(() => {
    if (!fullViewOpen) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setFullViewOpen(false);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopImmediatePropagation();
        move(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopImmediatePropagation();
        move(1);
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setZoom((current) => Math.min(4, Math.round((current + 0.25) * 100) / 100));
      }
      if (event.key === "-") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setZoom((current) => Math.max(1, Math.round((current - 0.25) * 100) / 100));
      }
    };

    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
    // move intentionally reads the latest photoUrls/index via React render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullViewOpen, photoUrls.length]);

  function move(direction: -1 | 1) {
    if (photoUrls.length < 2) return;
    setIndex((current) => {
      const safeCurrent = current ?? 0;
      return (safeCurrent + direction + photoUrls.length) % photoUrls.length;
    });
  }

  function openFullView() {
    if (!active) return;
    setZoom(1);
    setFullViewOpen(true);
  }

  if (!active) {
    if (photoUrls.length) {
      return <div className="showcasePhoto showcasePublicGallery showcasePhotoLoading" aria-hidden="true" />;
    }

    return (
      <div className="showcasePhoto showcasePublicGallery showcasePhotoFallback">
        <span>Made by You</span>
        <small>Customer review</small>
      </div>
    );
  }

  const imageClick = onPhotoClick ?? (showFullSizeLink ? openFullView : undefined);

  const fullView = fullViewOpen ? (
    <div className="showcasePhotoLightbox" role="presentation" onMouseDown={() => setFullViewOpen(false)}>
      <section className="showcasePhotoLightboxPanel" role="dialog" aria-modal="true" aria-label={`Full-size ${altBase}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="showcasePhotoLightboxToolbar">
          <span>{(index ?? 0) + 1} / {photoUrls.length}</span>
          <div>
            <button type="button" onClick={() => setZoom((current) => Math.max(1, Math.round((current - 0.25) * 100) / 100))} disabled={zoom <= 1} aria-label="Zoom out">−</button>
            <button type="button" onClick={() => setZoom(1)} aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => setZoom((current) => Math.min(4, Math.round((current + 0.25) * 100) / 100))} disabled={zoom >= 4} aria-label="Zoom in">+</button>
            <button type="button" className="showcasePhotoLightboxClose" onClick={() => setFullViewOpen(false)} aria-label="Close full photo">×</button>
          </div>
        </div>

        <div className="showcasePhotoLightboxCanvas">
          <img src={active} alt={`${altBase} photo ${(index ?? 0) + 1} full size`} style={{ transform: `scale(${zoom})` }} draggable={false} />
          {photoUrls.length > 1 ? <>
            <button className="showcasePhotoLightboxArrow isPrevious" type="button" onClick={() => move(-1)} aria-label="Previous full-size photo">‹</button>
            <button className="showcasePhotoLightboxArrow isNext" type="button" onClick={() => move(1)} aria-label="Next full-size photo">›</button>
          </> : null}
        </div>

        {photoUrls.length > 1 ? (
          <div className="showcasePhotoLightboxThumbs" aria-label="Full-size photo navigation">
            {photoUrls.map((url, photoIndex) => (
              <button key={`${url}-${photoIndex}`} type="button" className={photoIndex === index ? "isActive" : ""} onClick={() => setIndex(photoIndex)} aria-label={`View full-size photo ${photoIndex + 1}`}>
                <img src={url} alt="" />
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  ) : null;

  return <>
    <div
      className={`showcasePhoto showcasePublicGallery ${imageClick ? "isPhotoClickable" : ""}`}
      tabIndex={photoUrls.length > 1 ? 0 : -1}
      aria-label={photoUrls.length > 1 ? `Project photo ${(index ?? 0) + 1} of ${photoUrls.length}. Use arrow keys or swipe to browse.` : "Project photo"}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") move(-1);
        if (event.key === "ArrowRight") move(1);
        if ((event.key === "Enter" || event.key === " ") && imageClick) {
          event.preventDefault();
          imageClick();
        }
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
      <img className="showcaseGalleryBackdrop" src={active} alt="" aria-hidden="true" />
      <img
        className="showcaseGalleryImage"
        src={active}
        alt={`${altBase} photo ${(index ?? 0) + 1}`}
        onClick={imageClick}
      />

      {showFullSizeLink ? (
        <button
          className="showcaseFullSizeLink"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            openFullView();
          }}
        >
          View full photo ⤢
        </button>
      ) : null}

      {photoUrls.length > 1 ? <>
        <button className="showcaseGalleryArrow isPrevious" type="button" onClick={() => move(-1)} aria-label="Previous project photo">‹</button>
        <button className="showcaseGalleryArrow isNext" type="button" onClick={() => move(1)} aria-label="Next project photo">›</button>
        <span className="showcaseGalleryCount">{(index ?? 0) + 1} / {photoUrls.length}</span>
        <div className="showcaseGalleryDots" aria-label="Project photo navigation">
          {photoUrls.map((_, photoIndex) => (
            <button
              key={photoIndex}
              type="button"
              aria-label={`View photo ${photoIndex + 1}`}
              aria-current={photoIndex === index ? "true" : undefined}
              className={photoIndex === index ? "isActive" : ""}
              onClick={() => setIndex(photoIndex)}
            />
          ))}
        </div>
      </> : null}
    </div>

    {fullView && typeof document !== "undefined" ? createPortal(fullView, document.body) : null}
  </>;
}
