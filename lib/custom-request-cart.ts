"use client";

import type { ProductPreviewKind } from "@/lib/catalog";
import type { CatalogMockupSettings } from "@/lib/mockup-template-types";
import type { StructuredOrderItem } from "@/lib/order-types";

export const CUSTOM_REQUEST_CART_EVENT = "moore-made-request-cart-changed";
export const CUSTOM_REQUEST_CART_COUNT_KEY = "moore-made-request-cart-count";
export const CUSTOM_REQUEST_ACTIVE_SAVED_CART_KEY = "moore-made-active-saved-cart";

const DB_NAME = "moore-made-request-cart";
const DB_VERSION = 1;
const STORE_NAME = "items";

export type CartViewKey = "front" | "back";

export type SavedCartFile = {
  path: string;
  name: string;
  type: string;
  size: number;
  url?: string | null;
};

export type CartArtworkView = {
  view: CartViewKey;
  enabled: boolean;
  mode: "upload" | "idea";
  placement: string;
  placementLabel: string;
  idea: string;
  details: string;
  backgroundRemovalRequested?: boolean;
  file: File | null;
  savedFile?: SavedCartFile | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type CustomRequestCartItem = {
  id: string;
  createdAt: string;
  productSlug: string;
  productName: string;
  previewKind: ProductPreviewKind;
  viewLabels: { front: string; back: string };
  coverageLabel: string;
  colorName: string;
  customItemType: string;
  customColorNotes: string;
  mockupSettings?: CatalogMockupSettings;
  orderItems: StructuredOrderItem[];
  views: CartArtworkView[];
  reorderSourceRequestId?: string;
};

export type AccountSavedRequestCart = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  items: CustomRequestCartItem[];
};

function cartId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function openCartDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the request cart."));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not update the request cart."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not update the request cart."));
    transaction.onabort = () => reject(transaction.error || new Error("Could not update the request cart."));
  });
}

function announceCart(items: CustomRequestCartItem[]) {
  try {
    localStorage.setItem(CUSTOM_REQUEST_CART_COUNT_KEY, String(items.length));
  } catch {}
  window.dispatchEvent(new CustomEvent(CUSTOM_REQUEST_CART_EVENT, { detail: { count: items.length } }));
}

export function cachedCustomRequestCartCount() {
  if (typeof window === "undefined") return 0;
  try {
    return Math.max(0, Number(localStorage.getItem(CUSTOM_REQUEST_CART_COUNT_KEY) || 0));
  } catch {
    return 0;
  }
}

export function activeSavedRequestCartId() {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(CUSTOM_REQUEST_ACTIVE_SAVED_CART_KEY); } catch { return null; }
}

export function setActiveSavedRequestCartId(id: string | null) {
  try {
    if (id) localStorage.setItem(CUSTOM_REQUEST_ACTIVE_SAVED_CART_KEY, id);
    else localStorage.removeItem(CUSTOM_REQUEST_ACTIVE_SAVED_CART_KEY);
  } catch {}
}

export async function getCustomRequestCart() {
  const db = await openCartDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const items = await requestResult(transaction.objectStore(STORE_NAME).getAll()) as CustomRequestCartItem[];
    const sorted = items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    announceCart(sorted);
    return sorted;
  } finally {
    db.close();
  }
}

export async function addCustomRequestCartItem(item: Omit<CustomRequestCartItem, "id" | "createdAt">) {
  const record: CustomRequestCartItem = { ...item, id: cartId(), createdAt: new Date().toISOString() };
  const db = await openCartDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).put(record));
  } finally {
    db.close();
  }
  await getCustomRequestCart();
  return record;
}

export async function replaceCustomRequestCart(items: CustomRequestCartItem[]) {
  const db = await openCartDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    for (const item of items) store.put(item);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
  announceCart(items);
  return items;
}

export async function removeCustomRequestCartItem(id: string) {
  const db = await openCartDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).delete(id));
  } finally {
    db.close();
  }
  announceCart(await getCustomRequestCart());
}

export async function updateCustomRequestCartItem(id: string, patch: Partial<Omit<CustomRequestCartItem, "id" | "createdAt">>) {
  const current = (await getCustomRequestCart()).find((item) => item.id === id);
  if (!current) throw new Error("This cart item could not be found.");
  const db = await openCartDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).put({ ...current, ...patch, id: current.id, createdAt: current.createdAt }));
  } finally {
    db.close();
  }
  return getCustomRequestCart();
}

export async function clearCustomRequestCart() {
  const db = await openCartDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).clear());
  } finally {
    db.close();
  }
  announceCart([]);
}
