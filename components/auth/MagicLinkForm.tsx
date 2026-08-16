"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Props = {
  mode: "customer" | "admin";
  nextPath: string;
};

export function MagicLinkForm({ mode, nextPath }: Props) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: mode === "customer",
        },
      });
      if (authError) throw authError;
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the sign-in link.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="card authSentCard" role="status">
        <div className="successMark">✓</div>
        <h2>Check your email.</h2>
        <p>We sent a secure, one-time sign-in link to <strong>{email}</strong>.</p>
        <p className="muted">The link expires and can only be used once. You can close this page after opening the email.</p>
        <button className="btn secondary" type="button" onClick={() => setSent(false)}>Use a different email</button>
      </div>
    );
  }

  return (
    <form className="card authCard" onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${mode}-email`}>Email address</label>
        <input
          id={`${mode}-email`}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
          autoFocus
        />
      </div>
      {mode === "customer" ? (
        <p className="fieldHelp">New here? This same secure link creates your Moore Made account. No password to remember.</p>
      ) : (
        <p className="fieldHelp">Only pre-approved Moore Made staff accounts can enter the admin dashboard.</p>
      )}
      {error ? <div className="formError">{error}</div> : null}
      <button className="btn" type="submit" disabled={busy}>{busy ? "Sending..." : "Email me a secure sign-in link"}</button>
    </form>
  );
}
