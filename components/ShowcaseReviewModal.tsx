"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShowcasePhotoCarousel } from "@/components/ShowcasePhotoCarousel";
import type { PublicShowcasePost } from "@/lib/showcase-data";

export function ShowcaseReviewModal({ post, onClose }: { post: PublicShowcasePost; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const displayName = post.business_name || post.customer_name;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div className="showcaseModalBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`showcaseModal showcasePhotoReviewModal ${expanded ? "isReviewExpanded" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Review from ${displayName}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="showcaseModalClose" onClick={onClose} aria-label="Close review">×</button>

        <div className="showcaseModalMedia">
          <ShowcasePhotoCarousel
            photoUrls={post.photoUrls}
            altBase={`${post.product} customer project`}
            reviewId={post.id}
            showFullSizeLink
          />

          <div className="showcaseModalReviewOverlay">
            <div className="showcaseModalMeta">
              <span>{post.product}</span>
              <span className="stars" aria-label={`${post.rating} out of 5 stars`}>
                {"★".repeat(post.rating)}{"☆".repeat(5 - post.rating)}
              </span>
            </div>

            <h3>{displayName}</h3>

            <div className="showcaseModalReviewScroll">
              <p>“{post.review}”</p>
              {post.caption ? <p className="showcaseCaption">{post.caption}</p> : null}
            </div>

            <div className="showcaseModalOverlayActions">
              <button
                type="button"
                className="showcaseReviewToggle"
                onClick={() => setExpanded((current) => !current)}
                aria-expanded={expanded}
              >
                {expanded ? "Collapse review ↓" : "Read full review ↑"}
              </button>
              <Link className="textLink showcaseOverlayCta" href="/custom-orders">Want something like this? →</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
