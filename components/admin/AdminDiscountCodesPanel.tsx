"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { discountCodeLabel, type DiscountCodeRecord } from "@/lib/discount-types";
import { money } from "@/lib/quote-types";

type Props = { codes: DiscountCodeRecord[]; ready: boolean };

function inputDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AdminDiscountCodesPanel({ codes, ready }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (!ready) return <div className="requestNote"><strong>Discount codes need the latest database update.</strong> Run <code>supabase/moore_made_phase6_25_pricing_quotes_discounts.sql</code> in Supabase.</div>;

  async function save(event: FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault();
    setError("");
    setWorkingId(id || "new");
    const form = new FormData(event.currentTarget);
    const kind = String(form.get("kind") || "percent");
    const body = {
      code: String(form.get("code") || ""),
      description: String(form.get("description") || ""),
      kind,
      percentOff: kind === "percent" ? Number(form.get("value") || 0) : null,
      amountOffCents: kind === "fixed" ? Math.round(Number(form.get("value") || 0) * 100) : null,
      minOrderCents: Math.round(Number(form.get("minOrder") || 0) * 100),
      maxUses: form.get("maxUses") || null,
      perCustomerLimit: form.get("perCustomerLimit") || null,
      startsAt: form.get("startsAt") || null,
      expiresAt: form.get("expiresAt") || null,
      active: form.get("active") === "on",
    };
    const response = await fetch(id ? `/api/admin/discount-codes/${id}` : "/api/admin/discount-codes", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    setWorkingId(null);
    if (!response.ok) { setError(result.error || "Could not save the discount code."); return; }
    setCreating(false);
    setEditingId(null);
    router.refresh();
  }

  async function action(code: DiscountCodeRecord, actionName: "toggle" | "retire") {
    if (actionName === "retire" && !window.confirm(`Retire ${code.code}? Its history will stay saved, but it cannot be used again.`)) return;
    setError("");
    setWorkingId(code.id);
    const response = await fetch(`/api/admin/discount-codes/${code.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actionName === "toggle" ? { action: "toggle", active: !code.active } : { action: "retire" }),
    });
    const result = await response.json().catch(() => ({}));
    setWorkingId(null);
    if (!response.ok) { setError(result.error || "Could not update the discount code."); return; }
    router.refresh();
  }

  return <section className="discountAdminPanel">
    <div className="financePanelHead"><div><div className="eyebrow">Pricing controls</div><h3>Discount codes</h3><p>Create customer codes without changing your normal prices. Codes are case-insensitive and their use history stays attached to the business records.</p></div><button className="btn" type="button" onClick={() => { setCreating((value) => !value); setEditingId(null); }}>{creating ? "Close" : "New discount code"}</button></div>
    {error ? <div className="formError">{error}</div> : null}

    {creating ? <DiscountForm onSubmit={(event) => save(event)} saving={workingId === "new"} /> : null}

    <div className="discountCodeList">
      {codes.length === 0 ? <div className="empty"><strong>No discount codes yet.</strong><p>Create one when you want to offer a promotion, family rate, event code, or special customer discount.</p></div> : codes.map((code) => {
        const redemptions = code.discount_redemptions || [];
        const totalGiven = redemptions.reduce((sum, row) => sum + Number(row.discount_cents || 0), 0);
        const retired = Boolean(code.retired_at);
        return <article className={`discountCodeCard ${retired ? "isRetired" : ""}`} key={code.id}>
          <div className="discountCodeSummary">
            <div><span className="discountCodeName">{code.code}</span><strong>{discountCodeLabel(code)}</strong><small>{code.description || "No internal description"}</small></div>
            <div className="discountCodeStats"><span><small>Uses</small><strong>{redemptions.length}{code.max_uses ? ` / ${code.max_uses}` : ""}</strong></span><span><small>Discounts given</small><strong>{money(totalGiven)}</strong></span><span><small>Status</small><strong>{retired ? "Retired" : code.active ? "Active" : "Inactive"}</strong></span></div>
            {!retired ? <div className="discountCodeActions"><button className="textButton" type="button" onClick={() => setEditingId(editingId === code.id ? null : code.id)}>Edit</button><button className="textButton" type="button" disabled={workingId === code.id} onClick={() => action(code, "toggle")}>{code.active ? "Deactivate" : "Activate"}</button><button className="textButton dangerText" type="button" disabled={workingId === code.id} onClick={() => action(code, "retire")}>Retire</button></div> : null}
          </div>
          <div className="discountCodeRules"><span>Minimum: {money(code.min_order_cents || 0)}</span><span>Per customer: {code.per_customer_limit || "Unlimited"}</span><span>Starts: {code.starts_at ? new Date(code.starts_at).toLocaleDateString() : "Now"}</span><span>Expires: {code.expires_at ? new Date(code.expires_at).toLocaleDateString() : "Never"}</span></div>
          {editingId === code.id && !retired ? <DiscountForm code={code} onSubmit={(event) => save(event, code.id)} saving={workingId === code.id} /> : null}
          {redemptions.length ? <details className="discountUsageHistory"><summary>Usage history ({redemptions.length})</summary><div>{redemptions.slice().sort((a,b) => new Date(b.redeemed_at).getTime() - new Date(a.redeemed_at).getTime()).map((row) => <div key={row.id}><span>{row.customer_email}</span><strong>−{money(row.discount_cents)}</strong><small>{new Date(row.redeemed_at).toLocaleDateString()}</small></div>)}</div></details> : null}
        </article>;
      })}
    </div>
  </section>;
}

function DiscountForm({ code, onSubmit, saving }: { code?: DiscountCodeRecord; onSubmit: (event: FormEvent<HTMLFormElement>) => void; saving: boolean }) {
  const [kind, setKind] = useState<"percent" | "fixed">(code?.kind || "percent");
  return <form className="card discountCodeForm" onSubmit={onSubmit}>
    <div className="financeFormThree"><label className="field"><span>Code</span><input name="code" required defaultValue={code?.code || ""} placeholder="FAMILY10" /></label><label className="field"><span>Type</span><select name="kind" value={kind} onChange={(e) => setKind(e.target.value as "percent" | "fixed")}><option value="percent">Percent off</option><option value="fixed">Fixed amount</option></select></label><label className="field"><span>{kind === "percent" ? "Percent off" : "Dollar amount off"}</span><input name="value" type="number" required min="0.01" max={kind === "percent" ? 100 : undefined} step="0.01" defaultValue={kind === "percent" ? code?.percent_off || "" : code?.amount_off_cents ? code.amount_off_cents / 100 : ""} /></label></div>
    <label className="field"><span>Internal description <small>Optional</small></span><input name="description" defaultValue={code?.description || ""} placeholder="Family & friends, Pride event, first order…" /></label>
    <div className="financeFormThree"><label className="field"><span>Minimum order</span><input name="minOrder" type="number" min="0" step="0.01" defaultValue={(code?.min_order_cents || 0) / 100} /></label><label className="field"><span>Total use limit</span><input name="maxUses" type="number" min="1" step="1" defaultValue={code?.max_uses || ""} placeholder="Unlimited" /></label><label className="field"><span>Per-customer limit</span><input name="perCustomerLimit" type="number" min="1" step="1" defaultValue={code?.per_customer_limit || ""} placeholder="Unlimited" /></label></div>
    <div className="twoCol"><label className="field"><span>Starts <small>Optional</small></span><input name="startsAt" type="datetime-local" defaultValue={inputDateTime(code?.starts_at || null)} /></label><label className="field"><span>Expires <small>Optional</small></span><input name="expiresAt" type="datetime-local" defaultValue={inputDateTime(code?.expires_at || null)} /></label></div>
    <div className="discountFormFooter"><label className="consentBox compactConsent"><input name="active" type="checkbox" defaultChecked={code ? code.active : true} /><span>Active and available to use</span></label><button className="btn" disabled={saving} type="submit">{saving ? "Saving…" : code ? "Save changes" : "Create code"}</button></div>
  </form>;
}
