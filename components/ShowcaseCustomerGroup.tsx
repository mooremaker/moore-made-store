"use client";

import { useMemo, useState } from "react";
import { ShowcaseCard } from "@/components/ShowcaseCard";
import type { PublicShowcasePost } from "@/lib/showcase-data";

export function ShowcaseCustomerGroup({ posts }: { posts: PublicShowcasePost[] }) {
  const orderedPosts = useMemo(() => {
    const selected = posts.find((post) => post.customerPrimary);
    const chronological = [...posts].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    return selected
      ? [selected, ...chronological.filter((post) => post.id !== selected.id)]
      : chronological;
  }, [posts]);

  const [index, setIndex] = useState(0);
  const activePost = orderedPosts[Math.min(index, Math.max(0, orderedPosts.length - 1))] ?? null;

  if (!activePost) return null;

  function move(direction: -1 | 1) {
    if (orderedPosts.length < 2) return;
    setIndex((current) => (current + direction + orderedPosts.length) % orderedPosts.length);
  }

  return (
    <div className="showcaseCustomerGroup">
      <ShowcaseCard post={activePost} />
      {orderedPosts.length > 1 ? (
        <div className="showcaseCustomerReviewNav" aria-label={`Reviews from ${activePost.business_name || activePost.customer_name}`}>
          <button type="button" className="showcaseArrow" onClick={() => move(-1)} aria-label="Previous review from this customer">←</button>
          <span>{index + 1} of {orderedPosts.length} reviews</span>
          <button type="button" className="showcaseArrow" onClick={() => move(1)} aria-label="Next review from this customer">→</button>
        </div>
      ) : null}
    </div>
  );
}
