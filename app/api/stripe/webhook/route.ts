import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { markCheckoutSessionFailed, recordPaidCheckoutSession } from "@/lib/payment-server";
import { getStripe, stripeWebhookSecret } from "@/lib/stripe";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = stripeWebhookSecret();

  if (!signature || !secret) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 400 });
  }

  try {
    // Stripe signature verification requires the untouched raw request body.
    const payload = await request.text();
    const event = getStripe().webhooks.constructEvent(payload, signature, secret);

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await recordPaidCheckoutSession(event.data.object as Stripe.Checkout.Session);
        break;
      case "checkout.session.async_payment_failed":
        await markCheckoutSessionFailed(event.data.object as Stripe.Checkout.Session, "async_payment_failed");
        break;
      case "checkout.session.expired":
        await markCheckoutSessionFailed(event.data.object as Stripe.Checkout.Session, "expired");
        break;
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook failed", error);
    return NextResponse.json({ error: "Invalid Stripe webhook." }, { status: 400 });
  }
}
