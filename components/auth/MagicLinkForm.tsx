"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Props = {
  mode: "customer" | "admin";
  nextPath: string;
};

const RESEND_SECONDS = 45;

export function MagicLinkForm({ mode, nextPath }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setResendIn((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  async function sendSignInEmail() {
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
      setOtp("");
      setResendIn(RESEND_SECONDS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the sign-in email.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendSignInEmail();
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = otp.replace(/\D/g, "");
    if (token.length < 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }

    setVerifying(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token,
        type: "email",
      });
      if (verifyError) throw verifyError;
      router.replace(nextPath);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That sign-in code is invalid or expired.");
    } finally {
      setVerifying(false);
    }
  }

  if (sent) {
    return (
      <div className="card authSentCard" role="status">
        <div className="successMark">✓</div>
        <div className="eyebrow">Sign-in email sent</div>
        <h2>Check your email.</h2>
        <p>We sent secure sign-in instructions to <strong>{email}</strong>.</p>

        <form onSubmit={verifyCode} className="authOtpPrimary">
          <div className="field authCodeField">
            <label htmlFor={`${mode}-otp`}>6-digit sign-in code</label>
            <input
              id={`${mode}-otp`}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={10}
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              required
              autoFocus
            />
          </div>
          <p className="fieldHelp authEmailChoice">If the email also includes a <strong>Sign in to Moore Made</strong> button, you can tap that instead. Either method signs you into the same account.</p>
          {error ? <div className="formError">{error}</div> : null}
          <button className="btn" type="submit" disabled={verifying}>{verifying ? "Signing in..." : "Sign in"}</button>
        </form>

        <div className="authSecondaryActions">
          <button className="textButton" type="button" disabled={busy || resendIn > 0} onClick={() => void sendSignInEmail()}>
            {busy ? "Sending..." : resendIn > 0 ? `Resend email in ${resendIn}s` : "Resend sign-in email"}
          </button>
          <button className="textButton" type="button" onClick={() => { setSent(false); setError(""); setOtp(""); setResendIn(0); }}>Use a different email</button>
        </div>
      </div>
    );
  }

  return (
    <form className="card authCard" onSubmit={submit}>
      <div className="authIntroCompact">
        <div className="eyebrow">Password-free sign in</div>
        <p>{mode === "customer" ? "Enter your email and we’ll send a secure code. No password to create or remember." : "Enter your approved admin email. After email verification, you’ll complete the admin security check."}</p>
      </div>
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
        <p className="fieldHelp">New here? The same email creates your Moore Made account automatically.</p>
      ) : (
        <p className="fieldHelp">Only pre-approved Moore Made staff accounts can enter the admin dashboard.</p>
      )}
      {error ? <div className="formError">{error}</div> : null}
      <button className="btn" type="submit" disabled={busy}>{busy ? "Sending..." : "Send sign-in email"}</button>
    </form>
  );
}
