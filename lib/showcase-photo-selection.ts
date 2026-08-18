"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

const selectedPhotoByReview = new Map<string, number>();
const photoPreloads = new Map<string, Promise<void>>();

function getStableRandomIndex(reviewId: string, photoCount: number) {
  if (photoCount <= 1) return 0;

  const existing = selectedPhotoByReview.get(reviewId);
  if (existing != null && existing >= 0 && existing < photoCount) return existing;

  const next = Math.floor(Math.random() * photoCount);
  selectedPhotoByReview.set(reviewId, next);
  return next;
}

function preloadPhoto(src: string) {
  const existing = photoPreloads.get(src);
  if (existing) return existing;

  const pending = new Promise<void>((resolve) => {
    const image = new Image();
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    image.onload = async () => {
      try {
        if (typeof image.decode === "function") await image.decode();
      } catch {
        // A decoded image is ideal, but a completed load is still safe to reveal.
      }
      finish();
    };
    image.onerror = finish;
    image.src = src;

    if (image.complete) {
      void (async () => {
        try {
          if (typeof image.decode === "function") await image.decode();
        } catch {
          // Ignore decode failures and reveal the already-complete image.
        }
        finish();
      })();
    }
  });

  photoPreloads.set(src, pending);
  return pending;
}

/**
 * Chooses one random starting photo per review for the current page/app session.
 * For multi-photo reviews, the selected image is preloaded and decoded before
 * its index is exposed to the UI. This prevents the server-rendered first image
 * from flashing and then visibly switching after hydration.
 *
 * A hard browser refresh reloads this module and allows a new random choice.
 */
export function useRefreshStablePhotoIndex(reviewId: string, photoUrls: string[]) {
  const photoCount = photoUrls.length;
  const [index, setIndex] = useState<number | null>(() => {
    if (photoCount <= 1) return 0;
    return selectedPhotoByReview.get(reviewId) ?? null;
  });

  useEffect(() => {
    let cancelled = false;

    if (photoCount <= 0) {
      setIndex(0);
      return () => {
        cancelled = true;
      };
    }

    if (photoCount === 1) {
      setIndex(0);
      return () => {
        cancelled = true;
      };
    }

    const next = getStableRandomIndex(reviewId, photoCount);
    const selectedSrc = photoUrls[next];

    if (!selectedSrc) {
      setIndex(0);
      return () => {
        cancelled = true;
      };
    }

    void preloadPhoto(selectedSrc).then(() => {
      if (cancelled) return;
      setIndex(next);

      // Warm the rest of the gallery quietly after the visible starting image
      // is ready, so manual arrows/dots also feel responsive.
      for (const src of photoUrls) {
        if (src && src !== selectedSrc) void preloadPhoto(src);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [reviewId, photoCount, photoUrls]);

  return [index, setIndex] as const satisfies readonly [number | null, Dispatch<SetStateAction<number | null>>];
}
