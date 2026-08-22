import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Cash App is no longer accepted. Moore Made uses Stripe for all customer payments." },
    { status: 410 }
  );
}
