import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXPENSE_RECEIPT_BUCKET } from "@/lib/finance-types";

export const MAX_EXPENSE_RECEIPT_FILES = 10;
export const MAX_EXPENSE_RECEIPT_BYTES = 20 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const ALLOWED_EXTENSIONS = new Set(["pdf", "png", "jpg", "jpeg", "webp", "heic", "heif"]);

function extensionOf(name: string) {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() || "" : "";
}

function safeFileName(name: string) {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 180);
  return cleaned || "receipt";
}

export function validateExpenseReceiptFiles(files: File[]) {
  if (files.length > MAX_EXPENSE_RECEIPT_FILES) {
    return `Please attach no more than ${MAX_EXPENSE_RECEIPT_FILES} receipt files at a time.`;
  }

  for (const file of files) {
    if (file.size > MAX_EXPENSE_RECEIPT_BYTES) return `${file.name} is larger than 20 MB.`;
    const extensionAllowed = ALLOWED_EXTENSIONS.has(extensionOf(file.name));
    const mimeAllowed = !file.type || ALLOWED_MIME_TYPES.has(file.type);
    if (!extensionAllowed || !mimeAllowed) {
      return `${file.name} is not a supported receipt. Use PDF, PNG, JPG, WEBP, HEIC, or HEIF.`;
    }
  }

  return null;
}

export async function uploadExpenseReceiptFiles(
  supabase: SupabaseClient,
  expenseId: string,
  uploadedBy: string,
  files: File[]
) {
  const uploadedPaths: string[] = [];
  const metadata: Array<{
    expense_id: string;
    storage_path: string;
    original_filename: string;
    mime_type: string | null;
    size_bytes: number;
    uploaded_by: string;
  }> = [];

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const path = `${expenseId}/${Date.now()}-${index}-${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const bytes = Buffer.from(await file.arrayBuffer());
      const { error } = await supabase.storage.from(EXPENSE_RECEIPT_BUCKET).upload(path, bytes, {
        contentType: file.type || undefined,
        upsert: false,
      });
      if (error) throw error;

      uploadedPaths.push(path);
      metadata.push({
        expense_id: expenseId,
        storage_path: path,
        original_filename: file.name.slice(0, 240),
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: uploadedBy,
      });
    }

    if (metadata.length) {
      const { error } = await supabase.from("business_expense_receipts").insert(metadata);
      if (error) throw error;
    }

    return { ok: true as const };
  } catch (error) {
    console.error("Expense receipt upload failed", error);
    if (uploadedPaths.length) {
      await supabase.storage.from(EXPENSE_RECEIPT_BUCKET).remove(uploadedPaths);
    }
    return { ok: false as const, error };
  }
}
