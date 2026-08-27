"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { FINAL_SALE_POLICY_ACKNOWLEDGMENTS, FINAL_SALE_POLICY_VERSION } from "@/lib/payment-policy";

type Props = {
  token: string;
  proofVersion: number;
  policyReady: boolean;
  initialAccepted: boolean;
  initialAcceptedAt?: string | null;
  children: ReactNode;
};

function acceptedDate(value?: string | null) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

export function PaymentPolicyGate({ token, proofVersion, policyReady, initialAccepted, initialAcceptedAt, children }: Props) {
  const [checks, setChecks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(FINAL_SALE_POLICY_ACKNOWLEDGMENTS.map((item) => [item.key, false]))
  );
  const [accepted, setAccepted] = useState(initialAccepted);
  const [acceptedAt, setAcceptedAt] = useState(initialAcceptedAt || "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const allChecked = useMemo(
    () => FINAL_SALE_POLICY_ACKNOWLEDGMENTS.every((item) => checks[item.key] === true),
    [checks]
  );

  async function acceptTerms() {
    if (!allChecked) {
      setError("Please check every required acknowledgment before continuing to payment.");
      return;
    }
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/quotes/${token}/payment-policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checks),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save your acceptance.");
      setAccepted(true);
      setAcceptedAt(result.acceptedAt || new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your acceptance.");
    } finally {
      setWorking(false);
    }
  }

  if (!policyReady) {
    return <div className="requestWarning">Payment terms are temporarily unavailable. Please contact Moore Made before sending payment.</div>;
  }

  return (
    <div className="paymentPolicyGate">
      {accepted ? (
        <div className="paymentPolicyAccepted">
          <div>
            <span className="eyebrow">Final-sale terms accepted ✓</span>
            <strong>Payment options are unlocked.</strong>
            <p>
              You accepted policy {FINAL_SALE_POLICY_VERSION} for proof version {proofVersion}
              {acceptedDate(acceptedAt) ? ` on ${acceptedDate(acceptedAt)}` : ""}.
            </p>
          </div>
          <Link className="textLink" href="/terms/custom-orders" target="_blank">View terms ↗</Link>
        </div>
      ) : (
        <div className="paymentPolicyCard">
          <div className="paymentPolicyHeader">
            <div>
              <span className="eyebrow">Required before payment</span>
              <h3>Review the final-sale terms</h3>
              <p>Because your order is made specifically for you, these acknowledgments must be accepted before any payment option is unlocked.</p>
            </div>
            <span className="paymentPolicyVersion">{FINAL_SALE_POLICY_VERSION}</span>
          </div>

          <div className="paymentPolicyNotice">
            <strong>All custom-order sales are final.</strong>
            <p>Deposits and payments are non-refundable. Custom products cannot be returned or exchanged. If you are unhappy with your finished order, contact Moore Made and we will do our best to rectify the issue.</p>
          </div>

          <div className="paymentPolicyChecks">
            {FINAL_SALE_POLICY_ACKNOWLEDGMENTS.map((item) => (
              <label className="paymentPolicyCheck" key={item.key}>
                <input
                  type="checkbox"
                  checked={checks[item.key] || false}
                  onChange={(event) => setChecks((current) => ({ ...current, [item.key]: event.target.checked }))}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>

          <div className="paymentPolicyActions">
            <button className="btn" type="button" disabled={!allChecked || working} onClick={acceptTerms}>
              {working ? "Saving acceptance…" : "Accept terms & unlock payment"}
            </button>
            <Link className="textLink" href="/terms/custom-orders" target="_blank">Read full Custom Order Terms ↗</Link>
          </div>
          <p className="fieldHelp">Your acceptance is saved with this order, proof version, policy version, and timestamp.</p>
          {error ? <div className="formError">{error}</div> : null}
        </div>
      )}

      {accepted ? <div className="paymentPolicyUnlocked">{children}</div> : null}
    </div>
  );
}
