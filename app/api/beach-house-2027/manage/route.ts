import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sameOrigin } from "@/lib/beach-house-email";
import { parseBeachAmount, validBeachDate } from "@/lib/beach-house-tracker";
import { easternDate } from "@/lib/beach-house-payments";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (process.env.BEACH_HOUSE_TRACKER_ENABLED !== "true") return reply({ error: "Tracker setup is not complete." }, 503);
  try {
    const db = getSupabaseAdmin();
    const [members, records] = await Promise.all([
      db.from("beach_house_members").select("user_id,email,display_name,cash_app_name,room_number,share_people,status,checked_dates").order("room_number"),
      db.from("beach_house_contributions").select("id,member_id,pool_key,amount_cents,paid_date,reference,status,created_at,reviewed_at").order("created_at", { ascending: false }),
    ]);
    if (members.error || records.error) throw new Error("Organizer records unavailable.");
    return reply({ members: members.data || [], records: records.data || [] });
  } catch { console.error("Beach house organizer records could not be loaded."); return reply({ error: "Could not load the organizer tracker." }, 503); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: "Please use the organizer page." }, 403);
  const auth = await requireAdminApi();
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (process.env.BEACH_HOUSE_TRACKER_ENABLED !== "true") return reply({ error: "Tracker setup is not complete." }, 503);
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return reply({ error: "Invalid form." }, 400);
    const db = getSupabaseAdmin();
    if (body.action === "approveMember") {
      if (!uuid(body.memberId) || ![1,2,3,4].includes(body.room) || ![1,2].includes(body.sharePeople)) return reply({ error: "Select a room and room split." }, 400);
      const { error } = await db.rpc("approve_beach_house_member", { p_user_id: body.memberId, p_room: body.room, p_share_people: body.sharePeople });
      if (error?.code === "P0001") return reply({ error: "That room already has its allocated shares. Check the room assignments." }, 409);
      if (error) throw error;
      return reply({ ok: true });
    }
    if (body.action === "deactivateMember") {
      if (!uuid(body.memberId)) return reply({ error: "Invalid trip profile." }, 400);
      const { data, error } = await db.from("beach_house_members").update({ status: "inactive" }).eq("user_id", body.memberId).select("user_id").maybeSingle();
      if (error) throw error;
      return data ? reply({ ok: true }) : reply({ error: "Trip profile not found." }, 404);
    }
    if (body.action === "review") {
      if (!uuid(body.id) || !["pending","confirmed","rejected"].includes(body.status) || !["pending","confirmed","rejected"].includes(body.expectedStatus)) return reply({ error: "Invalid review." }, 400);
      if (body.status !== "pending" && body.expectedStatus !== "pending") return reply({ error: "Return this entry to review first." }, 409);
      if (body.status === "confirmed") {
        const { data: record, error } = await db.from("beach_house_contributions").select("member_id").eq("id", body.id).maybeSingle();
        if (error) throw error;
        const member = record ? await db.from("beach_house_members").select("status").eq("user_id", record.member_id).maybeSingle() : null;
        if (member?.error) throw member.error;
        if (member?.data?.status !== "active") return reply({ error: "Confirm this person’s room assignment first." }, 409);
      }
      const { data, error } = await db.from("beach_house_contributions").update({ status: body.status, reviewed_by: auth.user.id, reviewed_at: new Date().toISOString() }).eq("id", body.id).eq("status", body.expectedStatus).select("id").maybeSingle();
      if (error?.code === "23505") return reply({ error: "That transaction reference is already in use." }, 409);
      if (error) throw error;
      return data ? reply({ ok: true }) : reply({ error: "This payment changed. Refresh before reviewing it." }, 409);
    }
    if (body.action !== "add" || !uuid(body.id) || !uuid(body.memberId)) return reply({ error: "Invalid action." }, 400);
    const amount = parseBeachAmount(body.amount);
    const reference = typeof body.reference === "string" ? body.reference.trim().toLowerCase() : "";
    if (!amount || !["january","april"].includes(body.pool) || !validBeachDate(body.date, easternDate()) || reference.length > 120) return reply({ error: "Enter a valid amount, date, and pool." }, 400);
    const { data: member, error: memberError } = await db.from("beach_house_members").select("status").eq("user_id", body.memberId).maybeSingle();
    if (memberError) throw memberError;
    if (member?.status !== "active") return reply({ error: "Confirm the room assignment first." }, 409);
    const payload = { id: body.id, member_id: body.memberId, pool_key: body.pool, amount_cents: amount, paid_date: body.date, reference: reference || null, status: "confirmed", reviewed_by: auth.user.id, reviewed_at: new Date().toISOString() };
    const { error } = await db.from("beach_house_contributions").insert(payload);
    if (error?.code === "23505") {
      const { data: existing } = await db.from("beach_house_contributions").select("member_id,pool_key,amount_cents,paid_date,reference").eq("id", body.id).maybeSingle();
      if (existing && existing.member_id === payload.member_id && existing.pool_key === payload.pool_key && existing.amount_cents === amount && existing.paid_date === payload.paid_date && existing.reference === payload.reference) return reply({ ok: true });
      return reply({ error: "This payment or transaction reference was already recorded." }, 409);
    }
    if (error) throw error;
    return reply({ ok: true });
  } catch { console.error("Beach house organizer update failed."); return reply({ error: "That update could not be saved." }, 503); }
}
