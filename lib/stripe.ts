import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function isStripeConfigured() {
  return Boolean((process.env.STRIPE_SECRET_KEY || "").trim());
}

export function isStripeWebhookConfigured() {
  return Boolean((process.env.STRIPE_WEBHOOK_SECRET || "").trim());
}

export function getStripe() {
  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured.");
  if (!stripeClient) stripeClient = new Stripe(key);
  return stripeClient;
}

export function stripeWebhookSecret() {
  return (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
}
