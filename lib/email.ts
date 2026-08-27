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
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
};

export async function sendMooreMadeEmail(input: SendEmailInput) {
  const resend = getResend();
  const from = process.env.MOORE_MADE_FROM_EMAIL;
  const adminEmail = process.env.MOORE_MADE_ADMIN_EMAIL?.trim();

  if (!resend || !from) {
    return { ok: false as const, skipped: true as const, error: "Email is not configured." };
  }

  const recipients = (Array.isArray(input.to) ? input.to : [input.to]).map((email) => email.trim().toLowerCase());
  // Keep the owner's inbox as the complete, searchable record of what customers receive.
  // Do not BCC when the owner is already a direct recipient.
  const bcc = adminEmail && !recipients.includes(adminEmail.toLowerCase()) ? [adminEmail] : undefined;

  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    replyTo: input.replyTo,
    attachments: input.attachments,
    bcc,
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
  <body style="margin:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#202124;">
    <div style="max-width:680px;margin:0 auto;padding:34px 18px;">
      <div style="padding:0 6px 16px;"><div style="font-size:18px;font-weight:900;letter-spacing:.08em;">MOORE<span style="font-weight:400;">/</span>MADE</div><div style="margin-top:5px;font-size:12px;color:#6b7280;">Your Idea. Moore Made.</div></div>
      <div style="background:#ffffff;border:1px solid #e3e5e8;border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.03);">
        <div style="padding:12px 28px;border-bottom:1px solid #edf0f2;"><span style="display:inline-block;background:#eef4ef;color:#356046;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;">Moore Made update</span></div>
        <div style="padding:25px 28px 28px;"><h1 style="font-size:27px;line-height:1.15;margin:0 0 18px;letter-spacing:-.02em;">${escapeHtml(title)}</h1>
        ${body}
        </div>
      </div>
      <div style="font-size:12px;color:#6b7280;margin-top:16px;line-height:1.55;padding:0 6px;">Questions? Reply to this email or visit mooremade.store.<br>Custom orders are made for you and are final sale; if something is not right, please contact Moore Made so we can help.</div>
    </div>
  </body>
</html>`;
}
