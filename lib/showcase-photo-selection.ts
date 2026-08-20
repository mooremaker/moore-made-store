"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

type StoredSelection = {
  signature: string;
  index: number;
};

const selectedPhotoByReview =
  new Map<string, StoredSelection>();

const photoPreloads =
  new Map<string, Promise<void>>();

const STORAGE_PREFIX =
  "moore-made-showcase-start-photo:";

function stablePhotoIdentity(src: string) {
  try {
    const url = new URL(src);
    return `${url.origin}${url.pathname}`;
  } catch {
    return src.split("?")[0] ?? src;
  }
}

function makePhotoSignature(photoUrls: string[]) {
  return photoUrls.map(stablePhotoIdentity).join("\u001f");
}

function readPreviousSelection(
  reviewId: string
): StoredSelection | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(
      `${STORAGE_PREFIX}${reviewId}`
    );

    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredSelection;

    if (
      typeof parsed?.signature !== "string" ||
      typeof parsed?.index !== "number"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function saveSelection(
  reviewId: string,
  selection: StoredSelection
) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      `${STORAGE_PREFIX}${reviewId}`,
      JSON.stringify(selection)
    );
  } catch {
    // Photo selection still works if browser storage
    // is unavailable.
  }
}

function getStableRandomIndex(
  reviewId: string,
  photoUrls: string[],
  signature: string
) {
  const photoCount = photoUrls.length;

  if (photoCount <= 1) return 0;

  const existing =
    selectedPhotoByReview.get(reviewId);

  if (
    existing &&
    existing.signature === signature &&
    existing.index >= 0 &&
    existing.index < photoCount
  ) {
    return existing.index;
  }

  const previous =
    readPreviousSelection(reviewId);

  const previousIndex =
    previous &&
    previous.signature === signature &&
    previous.index >= 0 &&
    previous.index < photoCount
      ? previous.index
      : null;

  const possibleIndexes = Array.from(
    { length: photoCount },
    (_, index) => index
  ).filter(
    (index) =>
      photoCount <= 1 || index !== previousIndex
  );

  const randomPosition = Math.floor(
    Math.random() * possibleIndexes.length
  );

  const next =
    possibleIndexes[randomPosition] ?? 0;

  const selection = {
    signature,
    index: next,
  };

  selectedPhotoByReview.set(
    reviewId,
    selection
  );

  saveSelection(reviewId, selection);

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
        if (typeof image.decode === "function") {
          await image.decode();
        }
      } catch {
        // If decode fails after the file loaded,
        // it is still safe to reveal the image.
      }

      finish();
    };

    image.onerror = finish;

    image.src = src;

    if (image.complete) {
      void (async () => {
        try {
          if (typeof image.decode === "function") {
            await image.decode();
          }
        } catch {
          // Ignore decode failures for an
          // already-complete image.
        }

        finish();
      })();
    }
  });

  photoPreloads.set(src, pending);

  return pending;
}

/**
 * Picks one starting photo for each review and keeps it
 * unchanged while the visitor remains in the current app
 * session.
 *
 * If the browser page is refreshed, a multi-photo review
 * deliberately picks a different starting image from the
 * previous refresh whenever possible.
 *
 * The chosen photo is fully loaded before its index is
 * exposed to the UI, preventing a visible first-photo flash
 * followed by a switch.
 */
export function useRefreshStablePhotoIndex(
  reviewId: string,
  photoUrls: string[]
) {
  const photoCount = photoUrls.length;

  const photoSignature =
    makePhotoSignature(photoUrls);

  const photoUrlsRef = useRef(photoUrls);
  photoUrlsRef.current = photoUrls;

  const [index, setIndex] = useState<
    number | null
  >(() => {
    if (photoCount <= 1) return 0;

    const existing =
      selectedPhotoByReview.get(reviewId);

    if (
      existing &&
      existing.signature === photoSignature
    ) {
      return existing.index;
    }

    return null;
  });

  useEffect(() => {
    let cancelled = false;

    const currentUrls = photoUrlsRef.current;

    if (currentUrls.length <= 0) {
      setIndex(0);

      return () => {
        cancelled = true;
      };
    }

    if (currentUrls.length === 1) {
      setIndex(0);

      return () => {
        cancelled = true;
      };
    }

    const next = getStableRandomIndex(
      reviewId,
      currentUrls,
      photoSignature
    );

    const selectedSrc = currentUrls[next];

    if (!selectedSrc) {
      setIndex(0);

      return () => {
        cancelled = true;
      };
    }

    void preloadPhoto(selectedSrc).then(() => {
      if (cancelled) return;

      setIndex(next);

      // Quietly preload the rest of the review's
      // gallery after the starting photo is ready.
      for (const src of currentUrls) {
        if (src && src !== selectedSrc) {
          void preloadPhoto(src);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    reviewId,
    photoCount,
    photoSignature,
  ]);

  return [index, setIndex] as const satisfies readonly [
    number | null,
    Dispatch<SetStateAction<number | null>>,
  ];
}