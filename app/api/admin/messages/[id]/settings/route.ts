import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { MessageThreadStatus } from "@/lib/message-types";

const statuses = new Set<MessageThreadStatus>(["open","resolved","archived"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const updates: { status?: MessageThreadStatus; assigned_admin_user_id?: string | null } = {};
  if (typeof body.status === "string" && statuses.has(body.status as MessageThreadStatus)) updates.status = body.status as MessageThreadStatus;
  if (body.assignedAdminUserId === null || typeof body.assignedAdminUserId === "string") {
    const proposed = body.assignedAdminUserId || null;
    if (proposed) {
      const { data: role } = await getSupabaseAdmin().from("user_roles").select("role").eq("user_id", proposed).maybeSingle();
      if (role?.role !== "admin") return NextResponse.json({ error: "That user is not an admin." }, { status: 400 });
    }
    updates.assigned_admin_user_id = proposed;
  }
  if (!Object.keys(updates).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  const { error } = await getSupabaseAdmin().from("message_threads").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: "Could not update the conversation." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
