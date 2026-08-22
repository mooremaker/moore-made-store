import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { BUSINESS_GOAL_PRIORITY_LABELS, BUSINESS_GOAL_STATUS_LABELS, type BusinessGoalPriority, type BusinessGoalStatus } from "@/lib/finance-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const priorities = new Set(Object.keys(BUSINESS_GOAL_PRIORITY_LABELS));
const statuses = new Set(Object.keys(BUSINESS_GOAL_STATUS_LABELS));

function clean(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const form = await request.formData();
    const name = clean(form.get("name"), 160);
    const description = clean(form.get("description"), 1200) || null;
    const targetAmountCents = Math.round(Number(form.get("targetAmountCents") || 0));
    const priority = clean(form.get("priority"), 30) as BusinessGoalPriority;
    const status = clean(form.get("status"), 30) as BusinessGoalStatus;
    const targetDate = clean(form.get("targetDate"), 10) || null;
    const fundingSource = clean(form.get("fundingSource"), 250) || null;
    const note = clean(form.get("note"), 1500) || null;

    if (!name) return NextResponse.json({ error: "Enter a goal name." }, { status: 400 });
    if (!Number.isInteger(targetAmountCents) || targetAmountCents <= 0) return NextResponse.json({ error: "Enter a valid target amount." }, { status: 400 });
    if (!priorities.has(priority)) return NextResponse.json({ error: "Choose a valid priority." }, { status: 400 });
    if (!statuses.has(status)) return NextResponse.json({ error: "Choose a valid goal status." }, { status: 400 });
    if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return NextResponse.json({ error: "Choose a valid target date." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("business_goals").insert({
      name,
      description,
      target_amount_cents: targetAmountCents,
      priority,
      status,
      target_date: targetDate,
      funding_source: fundingSource,
      note,
      created_by: auth.user.id,
      updated_by: auth.user.id,
    }).select("id").single();

    if (error || !data) {
      console.error("Goal insert failed", error);
      return NextResponse.json({ error: "Could not save this business goal." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: data.id });
  } catch (error) {
    console.error("Goal route failed", error);
    return NextResponse.json({ error: "Could not save this business goal." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const id = clean(body.id, 80);
    const action = clean(body.action, 30);
    if (!id) return NextResponse.json({ error: "Goal id is required." }, { status: 400 });

    const supabase = getSupabaseAdmin();

    if (action === "edit") {
      const name = clean(body.name, 160);
      const description = clean(body.description, 1200) || null;
      const targetAmountCents = Math.round(Number(body.targetAmountCents || 0));
      const priority = clean(body.priority, 30) as BusinessGoalPriority;
      const status = clean(body.status, 30) as BusinessGoalStatus;
      const targetDate = clean(body.targetDate, 10) || null;
      const fundingSource = clean(body.fundingSource, 250) || null;
      const note = clean(body.note, 1500) || null;
      if (!name) return NextResponse.json({ error: "Enter a goal name." }, { status: 400 });
      if (!Number.isInteger(targetAmountCents) || targetAmountCents <= 0) return NextResponse.json({ error: "Enter a valid target amount." }, { status: 400 });
      if (!priorities.has(priority)) return NextResponse.json({ error: "Choose a valid priority." }, { status: 400 });
      if (!statuses.has(status)) return NextResponse.json({ error: "Choose a valid goal status." }, { status: 400 });
      if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return NextResponse.json({ error: "Choose a valid target date." }, { status: 400 });
      const { data, error } = await supabase.from("business_goals").update({
        name, description, target_amount_cents: targetAmountCents, priority, status,
        target_date: targetDate, funding_source: fundingSource, note, updated_by: auth.user.id,
      }).eq("id", id).is("voided_at", null).select("id").maybeSingle();
      if (error) return NextResponse.json({ error: "Could not save the goal changes." }, { status: 500 });
      if (!data) return NextResponse.json({ error: "Goal not found." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (action === "allocate" || action === "withdraw") {
      const amountCents = Math.round(Number(body.amountCents || 0));
      const fundingSource = clean(body.fundingSource, 250) || null;
      const note = clean(body.note, 1000) || null;
      if (!Number.isInteger(amountCents) || amountCents <= 0) return NextResponse.json({ error: "Enter a valid amount." }, { status: 400 });

      const { error } = await supabase.from("business_goal_funding").insert({
        goal_id: id,
        direction: action,
        amount_cents: amountCents,
        funding_source: fundingSource,
        note,
        recorded_by: auth.user.id,
      });
      if (error) return NextResponse.json({ error: "Could not update the goal funding." }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === "status") {
      const status = clean(body.status, 30) as BusinessGoalStatus;
      if (!statuses.has(status)) return NextResponse.json({ error: "Choose a valid goal status." }, { status: 400 });
      const { error } = await supabase.from("business_goals").update({ status, updated_by: auth.user.id }).eq("id", id).is("voided_at", null);
      if (error) return NextResponse.json({ error: "Could not update the goal status." }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === "void") {
      const reason = clean(body.reason, 500) || "Voided by admin";
      const { error } = await supabase.from("business_goals").update({
        voided_at: new Date().toISOString(),
        voided_by: auth.user.id,
        void_reason: reason,
        updated_by: auth.user.id,
      }).eq("id", id).is("voided_at", null);
      if (error) return NextResponse.json({ error: "Could not void this goal." }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Choose a valid goal action." }, { status: 400 });
  } catch (error) {
    console.error("Goal update failed", error);
    return NextResponse.json({ error: "Could not update this business goal." }, { status: 500 });
  }
}
