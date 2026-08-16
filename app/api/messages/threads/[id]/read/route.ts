import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authClient = await createSupabaseServerClient();
  const { data: authData } = await authClient.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { data: owned } = await authClient.from("message_threads").select("id").eq("id", id).maybeSingle();
  if (!owned) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  await getSupabaseAdmin().from("message_threads").update({ customer_unread_count: 0 }).eq("id", id);
  return NextResponse.json({ ok: true });
}
