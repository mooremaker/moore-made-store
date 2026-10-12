import { timingSafeEqual } from "node:crypto";
import { beachEmailPage, beachHouseEmailReady, emailLink, sendBeachEmail } from "@/lib/beach-house-email";
import { dueReminders, easternDate } from "@/lib/beach-house-payments";
import { publicSiteUrl, escapeHtml } from "@/lib/email";
import { beachInstallmentCoverage } from "@/lib/beach-house-tracker";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return new Response("Unauthorized", { status: 401 });
  if (!beachHouseEmailReady()) return Response.json({ error: "Reminders not configured." }, { status: 503 });
  // Preview deployments never send the group's scheduled emails.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return Response.json({ skipped: "Preview deployment" });
  const events = dueReminders(easternDate());
  if (!events.length) return Response.json({ sent: 0 });
  let sent = 0;
  let failed = 0;
  try {
    const db = getSupabaseAdmin();
    for (let start = 0; ; start += 100) {
      const { data: subscribers, error } = await db.from("beach_house_subscribers").select("id,email,unsubscribe_token").eq("status", "active").order("id").range(start, start + 99);
      if (error) throw error;
      for (const subscriber of subscribers || []) {
        let coverage: ReturnType<typeof beachInstallmentCoverage> | null = null;
        if (process.env.BEACH_HOUSE_TRACKER_ENABLED === "true") {
          const member = await db.from("beach_house_members").select("user_id,share_people,status").eq("email", subscriber.email.toLowerCase()).maybeSingle();
          if (member.error) throw member.error;
          if (member.data?.status === "inactive") continue;
          if (member.data?.status === "active") {
            const records = await db.from("beach_house_contributions").select("pool_key,amount_cents,status").eq("member_id", member.data.user_id).eq("status", "confirmed");
            if (records.error) throw records.error;
            coverage = beachInstallmentCoverage(member.data.share_people === 1 ? 1 : 2, records.data || []);
          }
        }
        for (const { payment, days } of events) {
          const installment = coverage?.find((item) => item.id === payment.id);
          if (installment?.covered) continue;
          const now = new Date().toISOString();
          const lock = new Date(Date.now() + 5 * 60000).toISOString();
          const delivery = { subscriber_id: subscriber.id, payment_date: payment.id, days_before: days, locked_until: lock };
          const inserted = await db.from("beach_house_reminder_deliveries").insert(delivery).select("id").single();
          let deliveryId = inserted.data?.id;
          if (inserted.error?.code === "23505") {
            const claimed = await db.from("beach_house_reminder_deliveries").update({ locked_until: lock }).eq("subscriber_id", subscriber.id).eq("payment_date", payment.id).eq("days_before", days).is("sent_at", null).lt("locked_until", now).select("id").maybeSingle();
            if (claimed.error) throw claimed.error;
            deliveryId = claimed.data?.id;
            if (!deliveryId) continue;
          } else if (inserted.error) throw inserted.error;
          if (!deliveryId) throw new Error("Delivery could not be reserved.");
          try {
            // Recheck opt-in immediately before sending, including concurrent unsubscribe requests.
            const { data: active, error: activeError } = await db.from("beach_house_subscribers").select("id").eq("id", subscriber.id).eq("status", "active").maybeSingle();
            if (activeError) throw activeError;
            if (!active) continue;
            const when = days === 0 ? "today" : days === 7 ? "in one week" : "in two weeks";
            const html = `<p>Our next beach house payment is due <strong>${when}: ${escapeHtml(payment.date)}</strong>.</p><p><strong>$${payment.room} per room / $${payment.person} per person</strong> when two people split equally.</p><p>Use the <strong>${payment.pool}</strong> pool for this payment.</p><p>${emailLink(payment.href, "Pay now in Cash App")}</p><p>${emailLink(`${publicSiteUrl()}/beach-house-2027`, "View the full payment schedule")}</p><p>If you’ve already paid, you’re all set—no additional payment is needed. Contributions are tracked in Cash App.</p><p>${emailLink(beachEmailPage(subscriber.unsubscribe_token, "unsubscribe"), "Unsubscribe from these reminders")}</p>`;
            const providerId = await sendBeachEmail(subscriber.email, `Beach house payment due ${when} — ${payment.date}`, html, `beach/${subscriber.id}/${payment.id}/${days}`);
            const updated = await db.from("beach_house_reminder_deliveries").update({ sent_at: new Date().toISOString(), provider_id: providerId }).eq("id", deliveryId);
            if (updated.error) throw updated.error;
            sent++;
          } catch {
            // Retrying the same reminder uses Resend's same idempotency key and immutable email body.
            await db.from("beach_house_reminder_deliveries").update({ locked_until: new Date().toISOString() }).eq("id", deliveryId).is("sent_at", null);
            failed++;
          }
        }
      }
      if (!subscribers || subscribers.length < 100) break;
    }
    if (failed) console.error("Beach house reminders had delivery failures.");
    return Response.json({ sent, failed }, { status: failed ? 503 : 200 });
  } catch {
    console.error("Beach house reminder job could not be completed.");
    return Response.json({ error: "Reminder job failed.", sent, failed }, { status: 503 });
  }
}
