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

function readableEmailError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : "Unknown Resend error.";
    const name = typeof record.name === "string" ? record.name : "";
    return name && !message.toLowerCase().includes(name.toLowerCase()) ? `${name}: ${message}` : message;
  }
  return String(error || "Unknown Resend error.");
}

export async function sendMooreMadeEmail(input: SendEmailInput) {
  const resend = getResend();
  const from = process.env.MOORE_MADE_FROM_EMAIL;

  if (!process.env.RESEND_API_KEY) {
    console.error("Moore Made email configuration missing: RESEND_API_KEY");
    return { ok: false as const, skipped: true as const, error: "RESEND_API_KEY is missing in the deployment environment." };
  }
  if (!from) {
    console.error("Moore Made email configuration missing: MOORE_MADE_FROM_EMAIL");
    return { ok: false as const, skipped: true as const, error: "MOORE_MADE_FROM_EMAIL is missing in the deployment environment." };
  }
  if (!resend) {
    return { ok: false as const, skipped: true as const, error: "Resend is not configured." };
  }

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      replyTo: input.replyTo,
    });

    if (error) {
      const message = readableEmailError(error);
      console.error("Resend email failed", {
        message,
        from,
        recipientCount: Array.isArray(input.to) ? input.to.length : 1,
        subject: input.subject,
      });
      return { ok: false as const, skipped: false as const, error: message };
    }

    return { ok: true as const, id: data?.id ?? null };
  } catch (error) {
    const message = readableEmailError(error);
    console.error("Resend email threw an exception", {
      message,
      from,
      recipientCount: Array.isArray(input.to) ? input.to.length : 1,
      subject: input.subject,
    });
    return { ok: false as const, skipped: false as const, error: message };
  }
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
