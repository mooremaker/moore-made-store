import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = await request.json();
  const { error } = await supabase.from("profiles").update({
    full_name: text(body.fullName, 160) || null,
    phone: text(body.phone, 80) || null,
  }).eq("id", authData.user.id);
  if (error) return NextResponse.json({ error: "Could not update your profile." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
