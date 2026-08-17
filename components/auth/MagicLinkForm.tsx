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
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: mode === "customer",
        },
      });
      if (authError) throw authError;
      setEmail(normalizedEmail);
      setCode("");
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the sign-in code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const token = code.replace(/\D/g, "").slice(0, 10);
      if (token.length < 6 || token.length > 10) throw new Error("Enter the full sign-in code from your email.");
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token,
        type: "email",
      });
      if (authError) throw authError;
      window.location.assign(nextPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That sign-in code could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <form className="card authCard" onSubmit={verifyCode}>
        <div className="successMark">✓</div>
        <h2>Check your email.</h2>
        <p>We sent a secure sign-in code to <strong>{email}</strong>.</p>
        <div className="field">
          <label htmlFor={`${mode}-code`}>Sign-in code</label>
          <input
            id={`${mode}-code`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6,10}"
            minLength={6}
            maxLength={10}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="Enter the code from your email"
            required
            autoFocus
          />
        </div>
        <p className="muted">Codes are one-time use and expire automatically. Using a typed code also prevents email security scanners from consuming your login before you do.</p>
        {error ? <div className="formError">{error}</div> : null}
        <button className="btn" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
        <button
          className="btn secondary"
          type="button"
          disabled={busy}
          onClick={() => { setSent(false); setCode(""); setError(""); }}
        >
          Send a new code or use a different email
        </button>
      </form>
    );
  }

  return (
    <form className="card authCard" onSubmit={requestCode}>
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
        <p className="fieldHelp">New here? This same secure code creates your Moore Made account. No password to remember.</p>
      ) : (
        <p className="fieldHelp">Only pre-approved Moore Made staff accounts can enter the admin dashboard.</p>
      )}
      {error ? <div className="formError">{error}</div> : null}
      <button className="btn" type="submit" disabled={busy}>{busy ? "Sending..." : "Email me a secure sign-in code"}</button>
    </form>
  );
}
