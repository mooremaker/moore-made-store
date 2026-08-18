"use client";

export type GuestShowcaseDraft = {
  savedAt: number;
  fields: {
    name: string;
    businessName: string;
    email: string;
    product: string;
    rating: string;
    review: string;
    caption: string;
    socialHandle: string;
    permission: boolean;
  };
  files: File[];
};

const DB_NAME = "moore-made-local-drafts";
const DB_VERSION = 1;
const STORE = "showcase-review";
const KEY = "pending-review-before-auth";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local draft storage."));
  });
}

export async function saveGuestShowcaseDraft(draft: GuestShowcaseDraft) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(draft, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not preserve this review."));
  });
  db.close();
}

export async function loadGuestShowcaseDraft(): Promise<GuestShowcaseDraft | null> {
  const db = await openDb();
  const value = await new Promise<GuestShowcaseDraft | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result as GuestShowcaseDraft | undefined);
    request.onerror = () => reject(request.error ?? new Error("Could not restore this review."));
  });
  db.close();
  if (!value) return null;
  if (Date.now() - value.savedAt > MAX_AGE_MS) {
    await clearGuestShowcaseDraft();
    return null;
  }
  return value;
}

export async function clearGuestShowcaseDraft() {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not clear the temporary review."));
  });
  db.close();
}
