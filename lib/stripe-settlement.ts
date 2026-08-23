import { getStripe } from "@/lib/stripe";

export async function retrieveStripeSettlement(paymentIntentId: string) {
  const intent = await getStripe().paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge.balance_transaction"],
  });
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const balanceTransaction = charge && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
  if (!balanceTransaction) return null;
  return {
    feeCents: Math.max(0, Number(balanceTransaction.fee || 0)),
    netCents: Math.max(0, Number(balanceTransaction.net || 0)),
    balanceTransactionId: balanceTransaction.id,
  };
}
