"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShowcaseCard } from "@/components/ShowcaseCard";
import type { PublicShowcasePost } from "@/lib/showcase-data";

export function HomeShowcaseCarousel({ posts }: { posts: PublicShowcasePost[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (posts.length > 1) {
      setIndex(Math.floor(Math.random() * posts.length));
    }
  }, [posts.length]);

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

  const active = posts[index] ?? posts[0];
  const move = (direction: -1 | 1) => {
    setIndex((current) => (current + direction + posts.length) % posts.length);
  };

  return (
    <div className="homeShowcaseCarousel">
      <div className="homeShowcaseStage">
        <ShowcaseCard post={active} />
      </div>
      <div className="homeShowcaseControls" aria-label="Made by You review controls">
        <button
          type="button"
          className="showcaseArrow"
          onClick={() => move(-1)}
          aria-label="Previous review"
          disabled={posts.length < 2}
        >
          ←
        </button>
        <span className="homeShowcaseCounter">{index + 1} / {posts.length}</span>
        <button
          type="button"
          className="showcaseArrow"
          onClick={() => move(1)}
          aria-label="Next review"
          disabled={posts.length < 2}
        >
          →
        </button>
      </div>
    </div>
  );
}
