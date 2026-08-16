"use client";

import { useState } from "react";
import type { FormEvent } from "react";

export function ProfileForm({ initialName, initialPhone }: { initialName: string; initialPhone: string }) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: name, phone }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update your profile.");
      setMessage("Profile saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update your profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="accountProfileForm" onSubmit={submit}>
      <div className="twoCol">
        <div className="field"><label htmlFor="account-name">Name</label><input id="account-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} /></div>
        <div className="field"><label htmlFor="account-phone">Phone</label><input id="account-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={80} /></div>
      </div>
      <div className="accountProfileActions"><button className="btn secondary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>{message ? <span className="successText">{message}</span> : null}{error ? <span className="formError compactError">{error}</span> : null}</div>
    </form>
  );
}
