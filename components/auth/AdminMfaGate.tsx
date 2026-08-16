"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "setup" | "challenge";

export function AdminMfaGate({ initialMode }: { initialMode: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [factorId, setFactorId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(initialMode === "challenge");
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode !== "challenge") return;
    let active = true;
    async function prepareChallenge() {
      const supabase = createSupabaseBrowserClient();
      try {
        const { data, error: listError } = await supabase.auth.mfa.listFactors();
        if (listError) throw listError;
        const factor = data.totp.find((item: { id: string; status: string }) => item.status === "verified");
        if (!factor) {
          if (active) { setMode("setup"); setBusy(false); }
          return;
        }
        const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id });
        if (challenge.error) throw challenge.error;
        if (active) {
          setFactorId(factor.id);
          setChallengeId(challenge.data.id);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not prepare MFA.");
      } finally {
        if (active) setBusy(false);
      }
    }
    prepareChallenge();
    return () => { active = false; };
  }, [mode]);

  async function beginSetup() {
    setBusy(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const enrollment = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Moore Made Admin" });
      if (enrollment.error) throw enrollment.error;
      setFactorId(enrollment.data.id);
      setQrCode(enrollment.data.totp.qr_code);
      setSecret(enrollment.data.totp.secret);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start authenticator setup.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!factorId || code.trim().length < 6) return;
    setBusy(true);
    setError("");
    const supabase = createSupabaseBrowserClient();
    try {
      let challenge = challengeId;
      if (!challenge) {
        const result = await supabase.auth.mfa.challenge({ factorId });
        if (result.error) throw result.error;
        challenge = result.data.id;
        setChallengeId(challenge);
      }
      const result = await supabase.auth.mfa.verify({ factorId, challengeId: challenge, code: code.trim() });
      if (result.error) throw result.error;
      router.replace("/admin");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That authenticator code did not work.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  const needsSetupStart = mode === "setup" && !factorId;

  return (
    <div className="card mfaCard">
      {mode === "setup" ? (
        <>
          <div className="eyebrow">Required for staff</div>
          <h2>Secure your admin account.</h2>
          <p>Moore Made requires a second factor before an administrator can view customer contact details or artwork.</p>
          {needsSetupStart ? <button className="btn" type="button" onClick={beginSetup} disabled={busy}>{busy ? "Preparing…" : "Set up authenticator app"}</button> : null}
          {qrCode ? <><p>Scan this QR code with Google Authenticator, Microsoft Authenticator, 1Password, or another TOTP authenticator app.</p><img className="mfaQr" src={qrCode} alt="Authenticator setup QR code" /></> : null}
          {secret ? <details className="mfaSecret"><summary>Can&apos;t scan the QR code?</summary><p>Enter this setup key manually:</p><code>{secret}</code></details> : null}
        </>
      ) : (
        <>
          <div className="eyebrow">Admin verification</div>
          <h2>Enter your authenticator code.</h2>
          <p>Open your authenticator app and enter the current 6-digit code for Moore Made Admin.</p>
        </>
      )}

      {!needsSetupStart ? <>
        <div className="field">
          <label htmlFor="mfa-code">6-digit code</label>
          <input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={8} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="123456" />
        </div>
        <button className="btn" type="button" disabled={busy || !factorId || code.length < 6} onClick={verify}>{busy ? "Verifying…" : mode === "setup" ? "Enable MFA & continue" : "Verify & open admin"}</button>
      </> : null}
      {error ? <div className="formError">{error}</div> : null}
      <form action="/api/auth/logout" method="post"><input type="hidden" name="next" value="/admin/login" /><button className="btn secondary" type="submit">Sign out</button></form>
    </div>
  );
}
