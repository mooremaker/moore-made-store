"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { ShowcaseReviewModal } from "@/components/ShowcaseReviewModal";
import type { PublicShowcasePost } from "@/lib/showcase-data";

const AUTO_ROTATE_MS = 9000;
const DESKTOP_CARD_COUNT = 3;

function CompactShowcaseCard({ post, onOpen }: { post: PublicShowcasePost; onOpen: () => void }) {
  const displayName = post.business_name || post.customer_name;
  const previewPhoto = post.photoUrls[0] ?? null;

  return (
    <article className="homeCompactReview card">
      <button type="button" className="homeCompactReviewMedia" onClick={onOpen} aria-label={`Open review from ${displayName}`}>
        {previewPhoto ? (
          <img src={previewPhoto} alt={`${post.product} customer project`} loading="lazy" decoding="async" />
        ) : (
          <span className="homeCompactReviewFallback">Made by You</span>
        )}
        {post.photoUrls.length > 1 ? <span className="homeCompactPhotoCount">{post.photoUrls.length} photos</span> : null}
      </button>

      <div className="homeCompactReviewBody">
        <div className="homeCompactReviewMeta">
          <span>{post.product}</span>
          <span className="stars" aria-label={`${post.rating} out of 5 stars`}>
            {"★".repeat(post.rating)}{"☆".repeat(5 - post.rating)}
          </span>
        </div>
        <h3>{displayName}</h3>
        <p>“{post.review}”</p>
        <div className="homeCompactReviewActions">
          <button type="button" className="textLink homeCompactOpen" onClick={onOpen}>View review →</button>
          <Link className="textLink" href="/custom-orders">Make something →</Link>
        </div>
      </div>
    </article>
  );
}

export function HomeShowcaseCarousel({ posts }: { posts: PublicShowcasePost[] }) {
  const [startIndex, setStartIndex] = useState(0);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [selectedPost, setSelectedPost] = useState<PublicShowcasePost | null>(null);
  const touchStartX = useRef<number | null>(null);
  const resumeTimer = useRef<number | null>(null);

  useEffect(() => {
    if (posts.length > 1) setStartIndex(Math.floor(Math.random() * posts.length));
    else setStartIndex(0);
  }, [posts.length]);

  useEffect(() => {
    if (posts.length < 2 || hoverPaused || selectedPost) return;
    const timer = window.setInterval(() => {
      setStartIndex((current) => (current + 1) % posts.length);
    }, AUTO_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [posts.length, hoverPaused, selectedPost]);

  const visiblePosts = useMemo(() => {
    if (!posts.length) return [];
    const count = Math.min(DESKTOP_CARD_COUNT, posts.length);
    return Array.from({ length: count }, (_, offset) => posts[(startIndex + offset) % posts.length]);
  }, [posts, startIndex]);

  if (!posts.length) {
    return (
      <div className="homeShowcaseCarousel homeShowcaseEmpty">
        <div className="showcasePlaceholder card homeShowcasePlaceholder">
          <span>Customer project</span>
          <strong>Made by You</strong>
        </div>
        <div className="homeShowcaseFooter">
          <span className="homeShowcaseCounter">No reviews yet</span>
          <Link className="textLink" href="/made-by-you/submit">Share your order →</Link>
        </div>
      </div>
    );
  }

  function move(direction: -1 | 1) {
    setStartIndex((current) => (current + direction + posts.length) % posts.length);
  }

  function pauseAfterTouch() {
    setHoverPaused(true);
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => setHoverPaused(false), 4500);
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
    pauseAfterTouch();
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStartX.current;
    const end = event.changedTouches[0]?.clientX ?? null;
    touchStartX.current = null;
    if (start == null || end == null) return;
    const delta = end - start;
    if (Math.abs(delta) < 45) return;
    move(delta < 0 ? 1 : -1);
  }

  return (
    <div
      className="homeShowcaseCarousel homeShowcaseCompact"
      onMouseEnter={() => setHoverPaused(true)}
      onMouseLeave={() => setHoverPaused(false)}
    >
      <div className="homeCompactReviewGrid" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {visiblePosts.map((post) => (
          <CompactShowcaseCard key={post.id} post={post} onOpen={() => setSelectedPost(post)} />
        ))}
      </div>

      {posts.length > 1 ? (
        <div className="homeCompactMobileNav" aria-label="Customer review controls">
          <button type="button" className="showcaseArrow" onClick={() => move(-1)} aria-label="Previous review">←</button>
          <span className="homeShowcaseCounter">{startIndex + 1} / {posts.length}</span>
          <button type="button" className="showcaseArrow" onClick={() => move(1)} aria-label="Next review">→</button>
        </div>
      ) : null}

      {posts.length > DESKTOP_CARD_COUNT ? (
        <div className="homeCompactReviewNav" aria-label="Featured review controls">
          <button type="button" className="showcaseArrow" onClick={() => move(-1)} aria-label="Previous reviews">←</button>
          <span className="homeShowcaseCounter">More customer projects</span>
          <button type="button" className="showcaseArrow" onClick={() => move(1)} aria-label="Next reviews">→</button>
        </div>
      ) : null}

      {selectedPost ? <ShowcaseReviewModal post={selectedPost} onClose={() => setSelectedPost(null)} /> : null}
    </div>
  );
}
