"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublicShowcasePost } from "@/lib/showcase-data";
import { ShowcasePhotoCarousel } from "@/components/ShowcasePhotoCarousel";
import { ShowcaseReviewModal } from "@/components/ShowcaseReviewModal";

type Props = {
  post: PublicShowcasePost;
  onExpandedChange?: (expanded: boolean) => void;
};

export function ShowcaseCard({ post, onExpandedChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const displayName = post.business_name || post.customer_name;

  useEffect(() => {
    setExpanded(false);
    onExpandedChange?.(false);
  }, [post.id, onExpandedChange]);

  function toggleReview() {
    const next = !expanded;
    setExpanded(next);
    onExpandedChange?.(next);
  }

  return (
    <>
      <article className={`showcaseCard showcaseOverlayCard card ${expanded ? "isReviewExpanded" : ""} ${post.photoUrls.length ? "hasPhotos" : "hasNoPhotos"}`}>
        <div className="showcaseMedia">
          <ShowcasePhotoCarousel
            photoUrls={post.photoUrls}
            altBase={`${post.product} customer project`}
            reviewId={post.id}
            onPhotoClick={() => setModalOpen(true)}
          />

          <div
            className="showcaseReviewOverlay showcaseReviewOverlayClickable"
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest("button, a")) return;
              setModalOpen(true);
            }}
          >
            <div className="showcaseOverlayMeta">
              <span>{post.product}</span>
              <span className="stars" aria-label={`${post.rating} out of 5 stars`}>
                {"★".repeat(post.rating)}{"☆".repeat(5 - post.rating)}
              </span>
            </div>

            <h3>{displayName}</h3>

            <div className="showcaseOverlayReviewScroll">
              <p className="showcaseReview">“{post.review}”</p>
              {post.caption ? <p className="showcaseCaption">{post.caption}</p> : null}
            </div>

            <div className="showcaseOverlayActions">
              <button type="button" className="showcaseReviewToggle" onClick={toggleReview} aria-expanded={expanded}>
                {expanded ? "Collapse review ↓" : "Read full review ↑"}
              </button>
              <Link className="textLink showcaseOverlayCta" href="/custom-orders">Want something like this? →</Link>
            </div>
          </div>
        </div>
      </article>

      {modalOpen ? <ShowcaseReviewModal post={post} onClose={() => setModalOpen(false)} /> : null}
    </>
  );
}
