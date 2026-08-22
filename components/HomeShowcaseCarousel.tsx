"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { ShowcaseReviewModal } from "@/components/ShowcaseReviewModal";
import type { PublicShowcasePost } from "@/lib/showcase-data";
import { useRefreshStablePhotoIndex } from "@/lib/showcase-photo-selection";

function CompactShowcaseCard({
  post,
  onOpen,
  reviewIndex,
  reviewCount,
  onMove,
}: {
  post: PublicShowcasePost;
  onOpen: () => void;
  reviewIndex: number;
  reviewCount: number;
  onMove: (direction: -1 | 1) => void;
}) {
  const displayName = post.business_name || post.customer_name;
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const [previewIndex] = useRefreshStablePhotoIndex(post.id, post.photoUrls);
  const previewPhoto = previewIndex == null ? null : post.photoUrls[previewIndex] ?? post.photoUrls[0] ?? null;
  const preview = previewIndex == null ? null : post.photoPreviews[previewIndex] ?? { x: 50, y: 50, zoom: 1 };

  useEffect(() => setReviewExpanded(false), [post.id]);

  return (
    <article className={`homeCompactReview homeSingleFeaturedReview card ${reviewExpanded ? "isReviewExpanded" : ""}`}>
      <button type="button" className="homeCompactReviewMedia" onClick={onOpen} aria-label={`Open review from ${displayName}`}>
        {previewPhoto ? (
          <img
            src={previewPhoto}
            alt={`${post.product} customer project`}
            loading="eager"
            decoding="async"
            style={preview ? { objectPosition: `${preview.x}% ${preview.y}%`, transform: `scale(${preview.zoom})`, transformOrigin: `${preview.x}% ${preview.y}%` } : undefined}
          />
        ) : post.photoUrls.length ? (
          <span className="homeCompactReviewLoading" aria-hidden="true" />
        ) : (
          <span className="homeCompactReviewFallback">Made by You</span>
        )}
        {post.photoUrls.length > 1 ? <span className="homeCompactPhotoCount">{post.photoUrls.length} photos</span> : null}
      </button>

      <div className="homeCompactReviewBody">
        <div className="homeCompactReviewMeta">
          <span>{post.product}</span>
          <span className="stars" aria-label={`${post.rating} out of 5 stars`}>{"★".repeat(post.rating)}{"☆".repeat(5 - post.rating)}</span>
        </div>
        <h3>{displayName}</h3>
        <p>“{post.review}”</p>

        {reviewCount > 1 ? (
          <div className="homeSingleReviewInlineNav" aria-label={`More reviews from ${displayName}`}>
            <button type="button" className="showcaseArrow" onClick={() => onMove(-1)} aria-label="Previous review from this customer">←</button>
            <span>Review {reviewIndex + 1} of {reviewCount}</span>
            <button type="button" className="showcaseArrow" onClick={() => onMove(1)} aria-label="Next review from this customer">→</button>
          </div>
        ) : null}

        <div className="homeCompactReviewActions">
          <button type="button" className="textLink homeCompactOpen" onClick={() => setReviewExpanded((current) => !current)} aria-expanded={reviewExpanded}>{reviewExpanded ? "Collapse review ↑" : "Show full review ↓"}</button>
          <Link className="textLink" href="/custom-orders">Make something →</Link>
        </div>
      </div>
    </article>
  );
}

export function HomeShowcaseCarousel({ posts }: { posts: PublicShowcasePost[] }) {
  const featuredPost = useMemo(
    () => posts.find((post) => post.homepageFeatured) ?? posts[0] ?? null,
    [posts]
  );

  const customerReviews = useMemo(() => {
    if (!featuredPost) return [];
    const sameCustomer = posts.filter((post) => post.customerGroupKey === featuredPost.customerGroupKey);
    const featuredFirst = sameCustomer.find((post) => post.id === featuredPost.id);
    return featuredFirst
      ? [featuredFirst, ...sameCustomer.filter((post) => post.id !== featuredPost.id)]
      : sameCustomer;
  }, [posts, featuredPost]);

  const [reviewIndex, setReviewIndex] = useState(0);
  const [selectedPost, setSelectedPost] = useState<PublicShowcasePost | null>(null);
  const touchStartX = useRef<number | null>(null);

  const activePost = customerReviews.length
    ? customerReviews[Math.min(reviewIndex, customerReviews.length - 1)]
    : null;

  if (!posts.length || !featuredPost || !activePost) {
    return (
      <div className="homeShowcaseCarousel homeShowcaseEmpty">
        <div className="showcasePlaceholder card homeShowcasePlaceholder"><span>Customer project</span><strong>Made by You</strong></div>
        <div className="homeShowcaseFooter"><span className="homeShowcaseCounter">No reviews yet</span><Link className="textLink" href="/made-by-you/submit">Share your order →</Link></div>
      </div>
    );
  }

  function move(direction: -1 | 1) {
    if (customerReviews.length < 2) return;
    setReviewIndex((current) => (current + direction + customerReviews.length) % customerReviews.length);
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStartX.current;
    const end = event.changedTouches[0]?.clientX ?? null;
    touchStartX.current = null;
    if (start == null || end == null || Math.abs(end - start) < 45) return;
    move(end < start ? 1 : -1);
  }

  return (
    <div className="homeShowcaseCarousel homeShowcaseCompact homeSingleFeaturedWrap">
      <div className="homeCompactReviewGrid homeSingleFeaturedGrid" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <CompactShowcaseCard
          post={activePost}
          onOpen={() => setSelectedPost(activePost)}
          reviewIndex={reviewIndex}
          reviewCount={customerReviews.length}
          onMove={move}
        />
      </div>

      {selectedPost ? <ShowcaseReviewModal post={selectedPost} onClose={() => setSelectedPost(null)} /> : null}
    </div>
  );
}
