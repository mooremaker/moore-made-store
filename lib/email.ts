import { Resend } from "resend";

function getResend() {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

export function isEmailConfigured() {
  return Boolean(
    process.env.RESEND_API_KEY &&
      process.env.MOORE_MADE_FROM_EMAIL &&
      process.env.MOORE_MADE_ADMIN_EMAIL
  );
}

export function siteUrl() {
  return (process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

// Customer-facing emails and share links must never point at localhost.
export function publicSiteUrl() {
  return (process.env.MOORE_MADE_PUBLIC_URL || "https://mooremade.store").replace(/\/$/, "");
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
};

export async function sendMooreMadeEmail(input: SendEmailInput) {
  const resend = getResend();
  const from = process.env.MOORE_MADE_FROM_EMAIL;

  if (!resend || !from) {
    return { ok: false as const, skipped: true as const, error: "Email is not configured." };
  }

  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    replyTo: input.replyTo,
  });

  if (error) {
    console.error("Resend email failed", error);
    return { ok: false as const, skipped: false as const, error: error.message };
  }

  return { ok: true as const, id: data?.id ?? null };
}

export function emailShell(title: string, body: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f7f5f0;font-family:Arial,Helvetica,sans-serif;color:#171717;">
    <div style="max-width:680px;margin:0 auto;padding:34px 18px;">
      <div style="font-size:14px;font-weight:900;letter-spacing:.14em;margin-bottom:18px;">MOORE MADE</div>
      <div style="background:#ffffff;border:1px solid #ded9d1;border-radius:20px;padding:28px;">
        <h1 style="font-size:28px;line-height:1.1;margin:0 0 18px;">${escapeHtml(title)}</h1>
        ${body}
      </div>
      <div style="font-size:12px;color:#777;margin-top:16px;line-height:1.5;">Moore Made · Custom goods, made your way.</div>
    </div>
  </body>
</html>`;
}
