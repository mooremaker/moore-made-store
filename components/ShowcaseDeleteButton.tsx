"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ShowcaseDeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm("Permanently delete this Made by You submission and its uploaded photos?")) return;
    setBusy(true);
    const response = await fetch("/api/admin/showcase-delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBusy(false);
    if (!response.ok) {
      window.alert("Could not delete this submission.");
      return;
    }
    router.refresh();
  }

  return <button className="btn secondary dangerButton" type="button" onClick={remove} disabled={busy}>{busy ? "Deleting…" : "Delete review"}</button>;
}
