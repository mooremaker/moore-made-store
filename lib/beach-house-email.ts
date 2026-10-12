import { Resend } from "resend";
import { escapeHtml, publicSiteUrl } from "@/lib/email";

export function beachHouseEmailReady() {
  return process.env.BEACH_HOUSE_REMINDERS_ENABLED === "true" && Boolean(process.env.RESEND_API_KEY && process.env.MOORE_MADE_FROM_EMAIL && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

export function beachEmailPage(token: string, action: "confirm" | "unsubscribe") {
  return `${publicSiteUrl()}/beach-house-2027/email?token=${encodeURIComponent(token)}&action=${action}`;
}

export async function sendBeachEmail(to: string, subject: string, body: string, idempotencyKey: string) {
  if (!beachHouseEmailReady()) throw new Error("Beach house email is not configured.");
  const result = await new Resend(process.env.RESEND_API_KEY!).emails.send({
    from: process.env.MOORE_MADE_FROM_EMAIL!,
    to,
    subject,
    replyTo: process.env.MOORE_MADE_ADMIN_EMAIL || undefined,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#ffffff;color:#333333;padding:24px;line-height:1.6"><div style="max-width:580px;margin:auto"><h1 style="color:#173d42;font-size:26px">Beach House 2027</h1>${body}</div></body></html>`,
  }, { idempotencyKey });
  if (result.error || !result.data?.id) throw new Error(result.error?.message || "Email could not be sent.");
  return result.data.id;
}

export function emailLink(href: string, label: string) {
  return `<a href="${escapeHtml(href)}" style="color:#17494c;font-weight:bold">${escapeHtml(label)}</a>`;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = [new URL(request.url).origin, publicSiteUrl()];
  return allowed.includes(origin);
}
