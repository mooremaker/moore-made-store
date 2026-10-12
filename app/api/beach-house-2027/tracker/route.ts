import { getCurrentUser, getUserRole } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sameOrigin } from "@/lib/beach-house-email";
import { beachHousePayments, easternDate } from "@/lib/beach-house-payments";
import { parseBeachAmount, validBeachDate } from "@/lib/beach-house-tracker";

const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
const ready = () => process.env.BEACH_HOUSE_TRACKER_ENABLED === "true";

export async function GET() {
  if (!ready()) return reply({ error: "Saved payment tracking is being set up." }, 503);
  try {
    const user = await getCurrentUser();
    if (!user || !user.email_confirmed_at) return reply({ error: "Sign in to save your payment progress." }, 401);
    const db = getSupabaseAdmin();
    const [member, records, role] = await Promise.all([
      db.from("beach_house_members").select("user_id,email,display_name,cash_app_name,room_number,share_people,status,checked_dates").eq("user_id", user.id).maybeSingle(),
      db.from("beach_house_contributions").select("id,member_id,pool_key,amount_cents,paid_date,reference,status,created_at,reviewed_at").eq("member_id", user.id).order("paid_date", { ascending: false }).order("created_at", { ascending: false }),
      getUserRole(user.id),
    ]);
    if (member.error || records.error) throw new Error("Tracker read failed.");
    return reply({ email: user.email, member: member.data, records: records.data || [], organizer: role === "admin" });
  } catch { console.error("Beach house tracker could not be loaded."); return reply({ error: "Your saved tracker could not be loaded. Please try again." }, 503); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: "Please use the beach house page." }, 403);
  if (!ready()) return reply({ error: "Saved payment tracking is being set up." }, 503);
  try {
    const user = await getCurrentUser();
    if (!user || !user.email_confirmed_at || !user.email) return reply({ error: "Sign in first." }, 401);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return reply({ error: "Please check the form." }, 400);
    const db = getSupabaseAdmin();
    if (body.action === "join") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const cashAppName = typeof body.cashAppName === "string" ? body.cashAppName.trim() : "";
      if (!name || name.length > 100 || !cashAppName || cashAppName.length > 100 || ![1,2,3,4].includes(body.room) || ![1,2].includes(body.sharePeople)) return reply({ error: "Enter your name, Cash App name, room, and room split." }, 400);
      const result = await db.from("beach_house_members").insert({ user_id: user.id, email: user.email.toLowerCase(), display_name: name, cash_app_name: cashAppName, room_number: body.room, share_people: body.sharePeople });
      if (result.error?.code === "23505") return reply({ error: "You already have a trip profile. Refresh your tracker." }, 409);
      if (result.error) throw result.error;
      return reply({ ok: true });
    }
    if (body.action === "check") {
      if (typeof body.checked !== "boolean" || !beachHousePayments.some((payment) => payment.id === body.date)) return reply({ error: "Invalid checklist item." }, 400);
      const { error } = await db.rpc("set_beach_house_check", { p_user_id: user.id, p_date: body.date, p_checked: body.checked });
      if (error) throw error;
      return reply({ ok: true });
    }
    if (body.action === "withdraw") {
      if (typeof body.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.id)) return reply({ error: "Invalid payment." }, 400);
      const { data, error } = await db.from("beach_house_contributions").update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("id", body.id).eq("member_id", user.id).eq("status", "pending").select("id").maybeSingle();
      if (error) throw error;
      return data ? reply({ ok: true }) : reply({ error: "Only your pending payments can be withdrawn." }, 409);
    }
    if (body.action !== "report") return reply({ error: "Invalid action." }, 400);
    const amount = parseBeachAmount(body.amount);
    const reference = typeof body.reference === "string" ? body.reference.trim().toLowerCase() : "";
    if (!amount || !["january", "april"].includes(body.pool) || !validBeachDate(body.date, easternDate()) || reference.length > 120 || typeof body.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.id)) return reply({ error: "Enter a valid amount, payment date, and pool." }, 400);
    const { data: member, error: memberError } = await db.from("beach_house_members").select("status").eq("user_id", user.id).maybeSingle();
    if (memberError) throw memberError;
    if (member?.status !== "active") return reply({ error: "Sal needs to confirm your room before you can record payments." }, 403);
    const payload = { id: body.id, member_id: user.id, pool_key: body.pool, amount_cents: amount, paid_date: body.date, reference: reference || null };
    const { error } = await db.from("beach_house_contributions").insert(payload);
    if (error?.code === "23505") {
      const { data: existing } = await db.from("beach_house_contributions").select("member_id,pool_key,amount_cents,paid_date,reference").eq("id", body.id).maybeSingle();
      if (existing && existing.member_id === user.id && existing.pool_key === payload.pool_key && existing.amount_cents === amount && existing.paid_date === payload.paid_date && existing.reference === payload.reference) return reply({ ok: true });
      return reply({ error: "This payment reference has already been recorded. Check your history or contact Sal." }, 409);
    }
    if (error) throw error;
    return reply({ ok: true });
  } catch { console.error("Beach house tracker update failed."); return reply({ error: "We couldn’t save that change. Please try again." }, 503); }
}
