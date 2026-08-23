import { NextResponse } from "next/server";
import { createSupportGiftCheckout } from "@/lib/support-gift-server";

function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (clean(body.website, 200)) return NextResponse.json({ ok: true });
  const name = clean(body.name, 160);
  const email = clean(body.email, 320).toLowerCase();
  const message = clean(body.message, 1500) || null;
  const rawAmount = clean(body.amount, 30);
  const amount = rawAmount ? Number(rawAmount) : null;
  if (!name) return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  if (amount !== null && (!Number.isFinite(amount) || amount < 1 || amount > 1000000)) return NextResponse.json({ error: "Enter an amount from $1 to $1,000,000, or leave it blank." }, { status: 400 });
  if (body.acknowledged !== true) return NextResponse.json({ error: "Please confirm the voluntary gift acknowledgement." }, { status: 400 });
  try {
    await createSupportGiftCheckout({ name, email, amountCents: amount === null ? null : Math.round(amount * 100), message });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Support gift link creation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "The gift link could not be created." }, { status: 500 });
  }
}

