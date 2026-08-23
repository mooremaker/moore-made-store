"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addCustomRequestCartItem, type CustomRequestCartItem } from "@/lib/custom-request-cart";

type ReorderView = Omit<CustomRequestCartItem["views"][number], "file" | "savedFile"> & { download?: { url: string; name: string } | null };
type ReorderItem = Omit<CustomRequestCartItem, "id" | "createdAt" | "views"> & { views: ReorderView[] };

export function ReorderRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reorder() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/account/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not prepare this reorder.");
      const items = Array.isArray(result.items) ? result.items as ReorderItem[] : [];
      if (!items.length) throw new Error("This order could not be copied into the cart.");
      const prepared = await Promise.all(items.map(async (item) => ({ ...item, views: await Promise.all(item.views.map(async (view) => {
        let file: File | null = null;
        if (view.download?.url) {
          const fileResponse = await fetch(view.download.url);
          if (!fileResponse.ok) throw new Error(`Could not reopen ${view.download.name}. Please try again.`);
          const blob = await fileResponse.blob();
          file = new File([blob], view.download.name, { type: blob.type });
        }
        const { download: _download, ...cleanView } = view;
        return { ...cleanView, file, savedFile: null };
      })) })));
      for (const item of prepared) await addCustomRequestCartItem(item);
      router.push("/cart?reorder=1");
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : "Could not prepare this reorder.");
      setBusy(false);
    }
  }

  return <div className="accountReorderAction"><button className="btn secondary" type="button" disabled={busy} onClick={reorder}>{busy ? "Copying to cart…" : "Reorder at original price"}</button>{error ? <small role="alert">{error}</small> : null}</div>;
}
