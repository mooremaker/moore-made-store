import { randomBytes } from "node:crypto";
import { beachEmailPage, beachHouseEmailReady, emailLink, sameOrigin, sendBeachEmail } from "@/lib/beach-house-email";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Please sign up from the beach house page." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Please enter your email address." }, { status: 400 });
  if (body.website) return Response.json({ ok: true });
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || body.consent !== true) return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
  if (!beachHouseEmailReady()) return Response.json({ error: "Email reminders aren’t available yet. Please try again once Sal has turned them on." }, { status: 503 });

  try {
    const db = getSupabaseAdmin();
    const { data: existing, error: readError } = await db.from("beach_house_subscribers").select("id,status,requested_at").eq("email", email).maybeSingle();
    if (readError) throw readError;
    if (existing?.status === "active") return Response.json({ ok: true, message: "You’re already signed up for payment reminders." });
    if (existing && Date.now() - Date.parse(existing.requested_at) < 3600000) return Response.json({ ok: true });
    const now = new Date();
    const token = randomBytes(32).toString("hex");
    const values = { email, status: "pending", confirmation_token: token, confirmation_expires_at: new Date(now.getTime() + 48 * 3600000).toISOString(), requested_at: now.toISOString() };
    const write = existing
      ? await db.from("beach_house_subscribers").update(values).eq("id", existing.id).eq("requested_at", existing.requested_at).select("id").maybeSingle()
      : await db.from("beach_house_subscribers").insert(values).select("id").single();
    // A concurrent request can win this email's unique row; it will send the confirmation.
    if (write.error?.code === "23505" || (!write.error && !write.data)) return Response.json({ ok: true });
    if (write.error) throw write.error;
    try {
      await sendBeachEmail(email, "Confirm your beach house payment reminders", `<p>You requested reminders for our June 12–19, 2027 Ocean City trip.</p><p>${emailLink(beachEmailPage(token, "confirm"), "Confirm my email reminders")}</p><p>After confirming, you’ll receive reminders two weeks before, one week before, and on each payment date. This confirmation link expires in 48 hours.</p><p>If you didn’t request these emails, ignore this message. You won’t receive reminders unless you confirm.</p>`, `beach-confirm/${token}`);
    } catch (error) {
      // Allow an immediate retry after a failed provider call using the same unique email row.
      await db.from("beach_house_subscribers").update({ requested_at: "2000-01-01T00:00:00Z" }).eq("confirmation_token", token);
      throw error;
    }
    return Response.json({ ok: true });
  } catch {
    console.error("Beach house reminder signup could not be completed.");
    return Response.json({ error: "We couldn’t send the confirmation email. Please try again shortly." }, { status: 503 });
  }
}
