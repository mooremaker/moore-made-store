import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Cash payments are no longer accepted. Please use a digital payment method." },
    { status: 410 }
  );
}
