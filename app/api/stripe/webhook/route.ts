import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { recordPaidCheckoutSession } from "@/lib/payment-server";
import { getStripe, stripeWebhookSecret } from "@/lib/stripe";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = stripeWebhookSecret();
  if (!signature || !secret) return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 400 });

  try {
    const payload = await request.text();
    const event = getStripe().webhooks.constructEvent(payload, signature, secret);

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await recordPaidCheckoutSession(event.data.object as Stripe.Checkout.Session);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook failed", error);
    return NextResponse.json({ error: "Invalid Stripe webhook." }, { status: 400 });
  }
}
