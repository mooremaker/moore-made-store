import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { emailShell, escapeHtml, publicSiteUrl, sendMooreMadeEmail } from "@/lib/email";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { recordCustomerEmailNotification } from "@/lib/message-server";

const BUCKET = "finished-product-files";
const MAX_PHOTOS = 12;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeName(value: string) {
  const base = value.split(/[\\/]/).pop() || "finished-photo";
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-120) || "finished-photo";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmails(value: unknown) {
  const raw = Array.isArray(value) ? value.map((item) => text(item, 320)) : text(value, 3200).split(/[;,\n]+/);
  return [...new Set(raw.map((item) => item.trim().toLowerCase()).filter((item) => item && validEmail(item)))].slice(0, 10);
}

async function loadOrder(requestId: string) {
  const supabase = getSupabaseAdmin();
  const { data: order, error } = await supabase
    .from("custom_requests")
    .select("id,request_number,customer_name,email,product,finished_photo_token")
    .eq("id", requestId)
    .maybeSingle();
  return { supabase, order, error };
}

async function signedPhotoRows(supabase: ReturnType<typeof getSupabaseAdmin>, requestId: string, expiresIn = 3600) {
  const { data, error } = await supabase
    .from("order_finished_photos")
    .select("id,storage_path,original_filename,mime_type,size_bytes,sort_order,created_at")
    .eq("request_id", requestId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (await Promise.all((data ?? []).map(async (row) => {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, expiresIn);
    return signed?.signedUrl ? { ...row, url: signed.signedUrl } : null;
  }))).filter(Boolean);
}

async function logFinishedPhotoEmail(input: {
  requestId: string;
  recipient: string;
  subject: string;
  status: "sent" | "failed";
  messageId?: string | null;
  error?: string | null;
  createdBy?: string | null;
}) {
  try {
    await getSupabaseAdmin().from("notification_email_log").insert({
      request_id: input.requestId,
      quote_id: null,
      notification_type: "finished_photos",
      recipient_email: input.recipient,
      subject: input.subject,
      status: input.status,
      provider_message_id: input.messageId || null,
      error_message: input.error || null,
      created_by: input.createdBy || null,
      sent_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Finished photo notification audit failed", error);
  }
}

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(request.url);
  const requestId = text(url.searchParams.get("requestId"), 100);
  if (!requestId) return NextResponse.json({ error: "Order is required." }, { status: 400 });

  try {
    const { supabase, order, error } = await loadOrder(requestId);
    if (error || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    const photos = await signedPhotoRows(supabase, requestId);
    const { data: logs } = await supabase
      .from("notification_email_log")
      .select("id,recipient_email,subject,status,error_message,sent_at")
      .eq("request_id", requestId)
      .eq("notification_type", "finished_photos")
      .order("sent_at", { ascending: false })
      .limit(12);

    return NextResponse.json({
      ok: true,
      photos,
      customerEmail: order.email,
      galleryUrl: `${publicSiteUrl()}/finished/${order.finished_photo_token}`,
      logs: logs ?? [],
    });
  } catch (error) {
    console.error("Finished product photos load failed", error);
    return NextResponse.json({ error: "Could not load finished product photos. Make sure Phase 6.37 SQL has been run." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const requestId = text(body.requestId, 100);
    const action = text(body.action, 40);
    if (!requestId) return NextResponse.json({ error: "Order is required." }, { status: 400 });

    const { supabase, order, error } = await loadOrder(requestId);
    if (error || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

    if (action === "prepare_uploads") {
      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length) return NextResponse.json({ error: "Choose at least one finished product photo." }, { status: 400 });

      const { count } = await supabase
        .from("order_finished_photos")
        .select("id", { count: "exact", head: true })
        .eq("request_id", requestId);
      const available = Math.max(0, MAX_PHOTOS - Number(count || 0));
      if (available === 0) return NextResponse.json({ error: `This order already has ${MAX_PHOTOS} finished product photos.` }, { status: 400 });
      if (files.length > available) return NextResponse.json({ error: `You can add ${available} more photo${available === 1 ? "" : "s"}.` }, { status: 400 });

      const uploads: Array<{ index: number; path: string; token: string }> = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index] as { name?: unknown; size?: unknown; type?: unknown };
        const name = typeof file.name === "string" ? file.name : "finished-photo";
        const size = typeof file.size === "number" ? file.size : 0;
        const type = typeof file.type === "string" ? file.type.toLowerCase() : "";
        if (!ALLOWED_TYPES.has(type)) return NextResponse.json({ error: `${name} is not a supported image type.` }, { status: 400 });
        if (size <= 0 || size > MAX_FILE_SIZE) return NextResponse.json({ error: `${name} must be 20 MB or smaller.` }, { status: 400 });

        const path = `${requestId}/${Date.now()}-${randomUUID()}-${safeName(name)}`;
        const { data, error: uploadError } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
        if (uploadError || !data?.token) return NextResponse.json({ error: "Could not prepare the finished photo upload." }, { status: 500 });
        uploads.push({ index, path, token: data.token });
      }
      return NextResponse.json({ uploads });
    }

    if (action === "finalize_uploads") {
      const items = Array.isArray(body.items) ? body.items : [];
      const normalized = items
        .map((item: unknown, index: number) => {
          const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
          return {
            storage_path: text(row.path, 1000),
            original_filename: text(row.name, 240) || `Finished photo ${index + 1}`,
            mime_type: text(row.type, 120) || null,
            size_bytes: typeof row.size === "number" ? Math.max(0, Math.floor(row.size)) : null,
          };
        })
        .filter((item: { storage_path: string }) => item.storage_path.startsWith(`${requestId}/`));

      if (!normalized.length) return NextResponse.json({ error: "No uploaded finished photos were provided." }, { status: 400 });

      const { data: current } = await supabase
        .from("order_finished_photos")
        .select("sort_order")
        .eq("request_id", requestId)
        .order("sort_order", { ascending: false })
        .limit(1);
      const startSort = Number(current?.[0]?.sort_order || 0) + 1;

      const { error: insertError } = await supabase.from("order_finished_photos").insert(
        normalized.map((item: typeof normalized[number], index: number) => ({
          request_id: requestId,
          ...item,
          sort_order: startSort + index,
          uploaded_by: auth.user.id,
        }))
      );
      if (insertError) return NextResponse.json({ error: "Could not save the finished product photos. Make sure Phase 6.37 SQL has been run." }, { status: 500 });

      return NextResponse.json({ ok: true, photos: await signedPhotoRows(supabase, requestId) });
    }

    if (action === "send_email") {
      const recipients = normalizeEmails(body.recipientEmails);
      if (!recipients.length) return NextResponse.json({ error: "Enter at least one valid email address." }, { status: 400 });

      const note = text(body.note, 2000);
      const photos = await signedPhotoRows(supabase, requestId, 60 * 60 * 24 * 7);
      if (!photos.length) return NextResponse.json({ error: "Upload at least one finished product photo before sending the email." }, { status: 409 });

      const galleryUrl = `${publicSiteUrl()}/finished/${order.finished_photo_token}`;
      const reference = formatRequestNumber(order.request_number);
      const subject = `Your finished Moore Made order photos — ${reference}`;
      const photoHtml = photos.slice(0, 6).map((photo, index) => `
        <td style="padding:4px;width:50%;vertical-align:top;">
          <a href="${escapeHtml(galleryUrl)}" style="text-decoration:none;">
            <img src="${escapeHtml(String(photo?.url || ""))}" alt="Finished product photo ${index + 1}" style="display:block;width:100%;height:220px;object-fit:cover;border-radius:12px;border:1px solid #ded9d1;background:#f7f5f0;">
          </a>
        </td>`).reduce((rows, cell, index) => {
          if (index % 2 === 0) rows.push(`<tr>${cell}`);
          else rows[rows.length - 1] += `${cell}</tr>`;
          return rows;
        }, [] as string[]);
      if (photoHtml.length && !photoHtml[photoHtml.length - 1].endsWith("</tr>")) photoHtml[photoHtml.length - 1] += `<td></td></tr>`;

      const customNote = note
        ? `<div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:14px 16px;margin:0 0 18px;line-height:1.7;">${escapeHtml(note).replaceAll("\n", "<br>")}</div>`
        : "";

      const htmlBody = `
        <p style="font-size:16px;line-height:1.7;margin:0 0 14px;">Hi ${escapeHtml(order.customer_name || "there")}, your Moore Made order <strong>${escapeHtml(reference)}</strong> has finished product photos ready to view.</p>
        ${customNote}
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 -4px 18px;"><tbody>${photoHtml.join("")}</tbody></table>
        <p style="margin:22px 0 12px;"><a href="${escapeHtml(galleryUrl)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;font-weight:800;padding:13px 20px;border-radius:999px;">View finished product photos</a></p>
        <div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:12px 14px;margin:0 0 18px;font-size:12px;line-height:1.55;color:#6b6b6b;word-break:break-all;">
          <strong style="color:#171717;">If the button does not open:</strong><br>
          Tap or copy this link into Safari/Chrome:<br>
          <a href="${escapeHtml(galleryUrl)}" style="color:#171717;">${escapeHtml(galleryUrl)}</a>
        </div>
        <p style="font-size:13px;line-height:1.6;color:#6b6b6b;margin:0;">The private gallery link remains usable even after the photo previews inside this email expire.</p>`;

      const sent: string[] = [];
      const failed: Array<{ email: string; error: string }> = [];
      for (const recipient of recipients) {
        const emailResult = await sendMooreMadeEmail({
          to: recipient,
          subject,
          replyTo: process.env.MOORE_MADE_ADMIN_EMAIL,
          html: emailShell("Your order is finished.", htmlBody),
        });
        if (emailResult.ok) {
          sent.push(recipient);
          await logFinishedPhotoEmail({ requestId, recipient, subject, status: "sent", messageId: emailResult.id, createdBy: auth.user.id });
        } else {
          const errorMessage = emailResult.error || "Email could not be sent.";
          failed.push({ email: recipient, error: errorMessage });
          await logFinishedPhotoEmail({ requestId, recipient, subject, status: "failed", error: errorMessage, createdBy: auth.user.id });
        }
      }

      if (!sent.length) return NextResponse.json({ error: failed[0]?.error || "Email could not be sent.", sent, failed }, { status: 502 });
      await recordCustomerEmailNotification({ requestId, recipientEmails: sent, subject, body: `Finished product photos are ready to view.${note ? ` Note: ${note}` : ""}`, topic: "order", label: "Finished product photo email sent" });
      return NextResponse.json({ ok: true, sent, failed, galleryUrl });
    }

    return NextResponse.json({ error: "Unknown finished-photo action." }, { status: 400 });
  } catch (error) {
    console.error("Finished product photo action failed", error);
    return NextResponse.json({ error: "Could not complete the finished product photo action." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const requestId = text(body.requestId, 100);
    const photoId = text(body.photoId, 100);
    if (!requestId || !photoId) return NextResponse.json({ error: "Invalid photo." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: photo, error } = await supabase
      .from("order_finished_photos")
      .select("id,storage_path")
      .eq("id", photoId)
      .eq("request_id", requestId)
      .maybeSingle();
    if (error || !photo) return NextResponse.json({ error: "Photo not found." }, { status: 404 });

    const { error: deleteError } = await supabase.from("order_finished_photos").delete().eq("id", photo.id);
    if (deleteError) return NextResponse.json({ error: "Could not remove the finished product photo." }, { status: 500 });

    const { error: storageError } = await supabase.storage.from(BUCKET).remove([photo.storage_path]);
    return NextResponse.json({
      ok: true,
      warning: storageError ? "The photo was removed from the order, but the stored file could not be deleted automatically." : null,
    });
  } catch (error) {
    console.error("Finished product photo delete failed", error);
    return NextResponse.json({ error: "Could not remove the finished product photo." }, { status: 500 });
  }
}
