"use client";

import { useEffect, useRef } from "react";
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
  const touchStartX = useRef<number | null>(null);
  const active = index == null ? null : (photoUrls[index] ?? null);

  useEffect(() => {
    if (!photoUrls.length) setIndex(0);
    else if (index != null && index > photoUrls.length - 1) setIndex(photoUrls.length - 1);
  }, [photoUrls.length, index, setIndex]);

  function move(direction: -1 | 1) {
    if (photoUrls.length < 2) return;
    setIndex((current) => {
      const safeCurrent = current ?? 0;
      return (safeCurrent + direction + photoUrls.length) % photoUrls.length;
    });
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

  return (
    <div
      className={`showcasePhoto showcasePublicGallery ${onPhotoClick ? "isPhotoClickable" : ""}`}
      tabIndex={photoUrls.length > 1 ? 0 : -1}
      aria-label={photoUrls.length > 1 ? `Project photo ${(index ?? 0) + 1} of ${photoUrls.length}. Use arrow keys or swipe to browse.` : "Project photo"}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") move(-1);
        if (event.key === "ArrowRight") move(1);
        if ((event.key === "Enter" || event.key === " ") && onPhotoClick) {
          event.preventDefault();
          onPhotoClick();
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
        onClick={onPhotoClick}
      />

      {showFullSizeLink ? (
        <a
          className="showcaseFullSizeLink"
          href={active}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          Full size ↗
        </a>
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
  );
}
