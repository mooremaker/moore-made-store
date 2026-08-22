import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";

export async function PATCH() {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ error: "Cash-payment arrangements are disabled. Moore Made uses Stripe only." }, { status: 410 });
}
