import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { publicSiteUrl } from "@/lib/email";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { SupportInquiryStatus } from "@/lib/support-types";

function clean(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cents(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

const statuses = new Set<SupportInquiryStatus>(["new", "contacted", "completed", "declined"]);

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = getSupabaseAdmin();
  const [{ data: settings, error: settingsError }, { data: inquiries, error: inquiryError }, { data: gifts, error: giftError }, { data: paymentGifts, error: paymentGiftError }, { data: businessSettings }, { data: goals }, { data: goalFunding }] = await Promise.all([
    supabase.from("support_page_settings").select("id,enabled,access_token,expires_at,phone,contact_email,funding_goal_cents,headline,introduction,updated_at").eq("id", "default").maybeSingle(),
    supabase.from("support_inquiries").select("id,name,email,phone,preferred_contact,amount_range,message,help_requested,gift_terms_acknowledged,status,admin_note,contacted_at,admin_email_sent_at,created_at").order("created_at", { ascending: false }),
    supabase.from("business_funding_entries").select("amount_cents").eq("entry_type", "gift_received").is("voided_at", null),
    supabase.from("support_gifts").select("id,donor_name,donor_email,donor_message,acknowledgement_version,acknowledgement_text,acknowledged_at,status,gross_amount_cents,stripe_fee_cents,net_amount_cents,stripe_payment_intent_id,paid_at,created_at").order("created_at", { ascending: false }),
    supabase.from("business_settings").select("weekly_sales_goal_cents,weekly_profit_goal_cents,weekly_owner_goal_cents,weekly_reserve_goal_cents").eq("id", "default").maybeSingle(),
    supabase.from("business_goals").select("id,name,description,target_amount_cents,status,voided_at").order("created_at", { ascending: true }),
    supabase.from("business_goal_funding").select("goal_id,direction,amount_cents"),
  ]);

  if (settingsError || inquiryError) return NextResponse.json({ error: "Support gifts need the Phase 6.48 database update." }, { status: 503 });
  const totalGiftCents = giftError ? 0 : (gifts || []).reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
  const activeGoals = (goals || []).filter((goal) => !goal.voided_at && !["completed", "cancelled", "purchased"].includes(goal.status));
  const savedByGoal = new Map<string, number>();
  for (const entry of goalFunding || []) {
    const amount = Number(entry.amount_cents || 0) * (entry.direction === "withdraw" ? -1 : 1);
    savedByGoal.set(entry.goal_id, (savedByGoal.get(entry.goal_id) || 0) + amount);
  }
  const calculatedGoalCents = activeGoals.reduce((sum, goal) => {
    const remaining = Number(goal.target_amount_cents || 0) - Math.max(0, savedByGoal.get(goal.id) || 0);
    return sum + Math.max(0, remaining);
  }, 0);
  const recommendedGoalCents = calculatedGoalCents || 5560000;
  const goalNames = activeGoals.map((goal) => goal.name).filter(Boolean);
  const weeklySalesGoalCents = Number(businessSettings?.weekly_sales_goal_cents ?? 750000);
  const weeklyProfitGoalCents = Number(businessSettings?.weekly_profit_goal_cents ?? 300000);
  const weeklyOwnerGoalCents = Number(businessSettings?.weekly_owner_goal_cents ?? 270000);
  const weeklyReserveGoalCents = Number(businessSettings?.weekly_reserve_goal_cents ?? 30000);
  const priorities = goalNames.length ? `${goalNames.slice(0, 4).join(", ")}${goalNames.length > 4 ? `, and ${goalNames.length - 4} more active goal${goalNames.length - 4 === 1 ? "" : "s"}` : ""}` : "DTF printer repair, dependable production supplies, embroidery, and a dedicated workshop or storefront";
  const goalSuggestions = {
    recommendedGoalCents,
    goalNames,
    weeklySalesGoalCents,
    weeklyProfitGoalCents,
    weeklyOwnerGoalCents,
    weeklyReserveGoalCents,
    suggestedHeadline: "Help Moore Made build what comes next.",
    suggestedIntroduction: `Moore Made is a two-owner custom-goods business with a clear plan: protect quality, strengthen production, and invest carefully in the equipment that helps us serve more customers.\n\nOur full-capacity targets are ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(weeklySalesGoalCents / 100)} in weekly sales and ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(weeklyProfitGoalCents / 100)} in weekly business profit. We are working toward them through stronger reserves, dependable systems, and ${priorities}. These are measured planning goals—not promised results.`,
  };
  return NextResponse.json({ settings, inquiries: inquiries || [], gifts: paymentGifts || [], giftsReady: !paymentGiftError, totalGiftCents, publicBaseUrl: publicSiteUrl(), goalSuggestions });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  const supabase = getSupabaseAdmin();

  if (body.action === "update_inquiry") {
    const id = clean(body.id, 80);
    const status = clean(body.status, 30) as SupportInquiryStatus;
    if (!id || !statuses.has(status)) return NextResponse.json({ error: "Choose a valid inquiry and status." }, { status: 400 });
    const { error } = await supabase.from("support_inquiries").update({
      status,
      admin_note: clean(body.adminNote, 1500) || null,
      contacted_at: status === "contacted" ? new Date().toISOString() : undefined,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return NextResponse.json({ error: "Could not update this supporter." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const enabled = body.enabled === true;
  const phone = clean(body.phone, 80);
  const contactEmail = clean(body.contactEmail, 320).toLowerCase();
  if (enabled && (!phone || !contactEmail)) return NextResponse.json({ error: "Add the Moore Made phone and email before publishing." }, { status: 400 });
  if (contactEmail && !/^\S+@\S+\.\S+$/.test(contactEmail)) return NextResponse.json({ error: "Enter a valid Moore Made email." }, { status: 400 });
  const expiresAt = clean(body.expiresAt, 40);
  const payload = {
    enabled,
    phone: phone || null,
    contact_email: contactEmail || null,
    funding_goal_cents: cents(body.fundingGoalCents),
    headline: clean(body.headline, 180) || "Help Moore Made grow with confidence.",
    introduction: clean(body.introduction, 1500) || "Moore Made is building a dependable custom-goods business centered on thoughtful design, clear customer approval, profitable pricing, and careful production.",
    expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    updated_by: auth.user.id,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("support_page_settings").update(payload).eq("id", "default");
  if (error) return NextResponse.json({ error: "Could not save the support page." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  if (body.action !== "rotate_token") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("support_page_settings").update({ access_token: randomUUID(), updated_by: auth.user.id, updated_at: new Date().toISOString() }).eq("id", "default").select("access_token").single();
  if (error || !data) return NextResponse.json({ error: "Could not regenerate the private link." }, { status: 500 });
  return NextResponse.json({ ok: true, accessToken: data.access_token });
}
