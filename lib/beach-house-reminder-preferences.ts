import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { beachHouseEmailReady } from "@/lib/beach-house-email";

// Caller must authenticate and derive this email from the verified session.
export async function setBeachReminderPreference(email: string, enabled: boolean) {
  if (!beachHouseEmailReady()) throw new Error("Reminders unavailable.");
  const db = getSupabaseAdmin();
  const normalized = email.toLowerCase();
  if (!enabled) {
    const { error } = await db.from("beach_house_subscribers").update({ status: "stopped" }).eq("email", normalized);
    if (error) throw error;
    return;
  }
  // Magic-link/code sign-in already verifies ownership. No second signup/email needed.
  // Omit unsubscribe_token so existing links remain valid on preference changes.
  const now = new Date().toISOString();
  const { error } = await db.from("beach_house_subscribers").upsert({ email: normalized, status: "active", confirmed_at: now, requested_at: now,
    confirmation_token: randomBytes(32).toString("hex"), confirmation_expires_at: now }, { onConflict: "email" });
  if (error) throw error;
}
