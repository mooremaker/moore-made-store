import type { SupabaseClient } from "@supabase/supabase-js";
import { emailShell, escapeHtml, sendMooreMadeEmail, siteUrl } from "@/lib/email";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const MESSAGE_BUCKET = "message-files";
export const MAX_MESSAGE_FILES = 10;
export const MAX_MESSAGE_FILE_BYTES = 20 * 1024 * 1024;
export const ALLOWED_MESSAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export function cleanMessageText(value: unknown, max = 6000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function safeMessageFileName(name: string) {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return cleaned || "attachment";
}

export function validateMessageFiles(files: File[]) {
  if (files.length > MAX_MESSAGE_FILES) return `Please attach no more than ${MAX_MESSAGE_FILES} files at a time.`;
  for (const file of files) {
    if (file.size > MAX_MESSAGE_FILE_BYTES) return `${file.name} is larger than 20 MB.`;
    if (!ALLOWED_MESSAGE_MIME_TYPES.has(file.type)) return `${file.name} is not a supported message attachment. Use PNG, JPG, WEBP, or PDF.`;
  }
  return null;
}

export async function uploadMessageAttachments(
  supabase: SupabaseClient,
  threadId: string,
  messageId: string,
  files: File[]
) {
  const uploaded: Array<{ path: string; originalName: string; mimeType: string; sizeBytes: number }> = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const path = `${threadId}/${messageId}/${Date.now()}-${index}-${safeMessageFileName(file.name)}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error } = await supabase.storage.from(MESSAGE_BUCKET).upload(path, bytes, {
      contentType: file.type,
      upsert: false,
    });
    if (error) {
      console.error("Message attachment upload failed", error);
      continue;
    }
    uploaded.push({ path, originalName: file.name.slice(0, 240), mimeType: file.type, sizeBytes: file.size });
  }

  if (uploaded.length) {
    const { error } = await supabase.from("message_attachments").insert(
      uploaded.map((file) => ({
        message_id: messageId,
        storage_path: file.path,
        original_filename: file.originalName,
        mime_type: file.mimeType,
        size_bytes: file.sizeBytes,
      }))
    );
    if (error) console.error("Message attachment metadata insert failed", error);
  }

  return uploaded;
}

export function customerSafeStaffName(value: string | null | undefined, fallback = "Moore Made") {
  const cleaned = value?.trim();
  if (!cleaned) return fallback;
  const first = cleaned.split(/\s+/)[0]?.trim();
  return first || fallback;
}

export async function getDisplayName(userId: string, fallback: string) {
  const admin = getSupabaseAdmin();
  const { data: profile } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return profile?.full_name?.trim() || fallback;
}

export function adminNotificationEmails() {
  const combined = process.env.MOORE_MADE_ADMIN_EMAILS || process.env.MOORE_MADE_ADMIN_EMAIL || "";
  return combined.split(",").map((value) => value.trim()).filter(Boolean);
}

export async function notifyAdminsOfCustomerMessage(input: {
  customerName: string;
  customerEmail: string;
  subject: string;
  body: string;
  orderReference?: string | null;
}) {
  const recipients = adminNotificationEmails();
  if (!recipients.length) return;
  const context = input.orderReference ? ` · ${input.orderReference}` : "";
  await sendMooreMadeEmail({
    to: recipients,
    subject: `New Moore Made message${context} — ${input.customerName}`,
    replyTo: input.customerEmail,
    html: emailShell(
      "New customer message",
      `<p style="line-height:1.65;margin:0 0 12px;"><strong>${escapeHtml(input.customerName)}</strong>${input.orderReference ? ` sent a message about <strong>${escapeHtml(input.orderReference)}</strong>.` : " sent Moore Made a general message."}</p>
       <p style="line-height:1.65;margin:0 0 8px;"><strong>${escapeHtml(input.subject)}</strong></p>
       <div style="background:#f7f5f0;border-radius:12px;padding:14px;line-height:1.6;margin-bottom:18px;">${escapeHtml(input.body).replaceAll("\n", "<br>")}</div>
       <a href="${siteUrl()}/admin" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:800;">Open admin messages</a>`
    ),
  });
}

export async function notifyCustomerOfAdminReply(input: {
  customerEmail: string;
  customerName: string;
  staffName: string;
  subject: string;
  body: string;
  threadId: string;
  orderReference?: string | null;
}) {
  const customerVisibleStaffName = customerSafeStaffName(input.staffName);
  await sendMooreMadeEmail({
    to: input.customerEmail,
    subject: `New Moore Made message${input.orderReference ? ` — ${input.orderReference}` : ""}`,
    html: emailShell(
      "Moore Made replied.",
      `<p style="line-height:1.65;margin:0 0 12px;">Hi ${escapeHtml(input.customerName)}, <strong>${escapeHtml(customerVisibleStaffName)}</strong> from Moore Made sent you a new message${input.orderReference ? ` about <strong>${escapeHtml(input.orderReference)}</strong>` : ""}.</p>
       <p style="line-height:1.65;margin:0 0 8px;"><strong>${escapeHtml(input.subject)}</strong></p>
       <div style="background:#f7f5f0;border-radius:12px;padding:14px;line-height:1.6;margin-bottom:18px;">${escapeHtml(input.body).replaceAll("\n", "<br>")}</div>
       <a href="${siteUrl()}/account/messages?thread=${encodeURIComponent(input.threadId)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:800;">View and reply</a>`
    ),
  });
}
