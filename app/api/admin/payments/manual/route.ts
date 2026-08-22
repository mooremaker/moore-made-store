import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";

export async function POST() {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ error: "Manual payments are disabled. Use Stripe Checkout." }, { status: 410 });
}
