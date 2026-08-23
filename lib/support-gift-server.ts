import type Stripe from "stripe";
import { emailShell, escapeHtml, publicSiteUrl, sendMooreMadeEmail } from "@/lib/email";
import { getStripe } from "@/lib/stripe";
import { retrieveStripeSettlement } from "@/lib/stripe-settlement";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { GIFT_ACKNOWLEDGEMENT, GIFT_ACKNOWLEDGEMENT_VERSION } from "@/lib/support-types";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function giftTermsHtml() {
  return `<div style="margin:18px 0;padding:14px 16px;border:1px solid #decfbf;border-radius:12px;background:#faf7f2;color:#55483f;font-size:13px;line-height:1.55;"><strong>Voluntary gift acknowledgement</strong><br>${escapeHtml(GIFT_ACKNOWLEDGEMENT)}</div>`;
}

export async function createSupportGiftCheckout(input: { name: string; email: string; amountCents: number | null; message: string | null }) {
  const supabase = getSupabaseAdmin();
  const acknowledgedAt = new Date().toISOString();
  const { data: gift, error } = await supabase.from("support_gifts").insert({
    donor_name: input.name,
    donor_email: input.email,
    suggested_amount_cents: input.amountCents,
    donor_message: input.message,
    acknowledgement_version: GIFT_ACKNOWLEDGEMENT_VERSION,
    acknowledgement_text: GIFT_ACKNOWLEDGEMENT,
    acknowledged_at: acknowledgedAt,
  }).select("id,receipt_token").single();
  if (error || !gift) throw new Error("Could not save the gift request. Run the Phase 6.61 database update if it has not been applied.");

  const stripe = getStripe();
  const products = await stripe.products.list({ active: true, limit: 100 });
  let product = products.data.find((row) => row.metadata?.moore_made_kind === "voluntary_gift");
  if (!product) product = await stripe.products.create({ name: "Gift Moore Made’s Growth", description: "A voluntary, non-repayable gift to Moore Made LLC. No goods or services are provided.", metadata: { moore_made_kind: "voluntary_gift" } });

  const price = await stripe.prices.create({
    currency: "usd",
    product: product.id,
    custom_unit_amount: {
      enabled: true,
      minimum: 100,
      maximum: 100000000,
      ...(input.amountCents ? { preset: input.amountCents } : {}),
    },
  });
  const paymentLink = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    submit_type: "donate",
    metadata: { kind: "support_gift", support_gift_id: gift.id, acknowledgement_version: GIFT_ACKNOWLEDGEMENT_VERSION },
    payment_intent_data: { metadata: { kind: "support_gift", support_gift_id: gift.id, acknowledgement_version: GIFT_ACKNOWLEDGEMENT_VERSION } },
    custom_text: {
      submit: { message: "Voluntary, non-repayable gift. No ownership, repayment, interest, profit sharing, goods/services, future discounts, or tax deduction." },
      after_submit: { message: "Thank you for making a voluntary gift to Moore Made LLC. No goods or services were provided." },
    },
    after_completion: { type: "redirect", redirect: { url: `${publicSiteUrl()}/gift/thank-you` } },
  });
  const { error: updateError } = await supabase.from("support_gifts").update({ stripe_payment_link_id: paymentLink.id, checkout_url: paymentLink.url, status: "pending", updated_at: new Date().toISOString() }).eq("id", gift.id);
  if (updateError) throw new Error("The checkout link was created, but could not be saved.");

  const sent = await sendMooreMadeEmail({
    to: input.email,
    subject: "Your private Moore Made gift link",
    html: emailShell("Complete your voluntary gift", `<p style="line-height:1.65;margin:0 0 14px;">Hi ${escapeHtml(input.name)}, thank you for choosing to support Moore Made’s growth.</p>${input.amountCents ? `<p style="line-height:1.65;margin:0 0 14px;">Your suggested gift amount is <strong>${escapeHtml(money(input.amountCents))}</strong>. You can change it securely on Stripe.</p>` : `<p style="line-height:1.65;margin:0 0 14px;">Choose the amount you would like to give securely on Stripe.</p>`}${giftTermsHtml()}<a href="${escapeHtml(paymentLink.url)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:13px 20px;border-radius:999px;font-weight:800;">Open secure gift checkout</a><p style="margin:18px 0 0;color:#6b7280;font-size:12px;line-height:1.5;">This unique link was created for ${escapeHtml(input.email)}. No charge has been made yet.</p>`),
  });
  await supabase.from("support_gifts").update(sent.ok ? { status: "link_sent", link_email_sent_at: new Date().toISOString(), link_email_error: null, updated_at: new Date().toISOString() } : { link_email_error: sent.error, updated_at: new Date().toISOString() }).eq("id", gift.id);
  if (!sent.ok) throw new Error("The secure link was created, but the email could not be sent. Moore Made can resend it from Stripe or the admin record.");
  return { id: gift.id };
}

export async function markSupportGiftFailed(session: Stripe.Checkout.Session, status: "failed" | "expired" = "failed") {
  const giftId = session.metadata?.support_gift_id;
  if (!giftId) return;
  await getSupabaseAdmin().from("support_gifts").update({ status, stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() }).eq("id", giftId).neq("status", "paid");
}

export async function recordPaidSupportGift(session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") return;
  const giftId = session.metadata?.support_gift_id;
  if (!giftId) throw new Error("Gift checkout metadata is incomplete.");
  const supabase = getSupabaseAdmin();
  const { data: gift, error } = await supabase.from("support_gifts").select("id,receipt_token,donor_name,donor_email,donor_message,acknowledgement_version,acknowledgement_text,acknowledged_at,status,funding_entry_id,stripe_payment_link_id").eq("id", giftId).single();
  if (error || !gift) throw new Error("Gift record not found.");
  const alreadyPaid = gift.status === "paid";
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
  const gross = Math.max(0, Number(session.amount_total || 0));
  if (!gross || !paymentIntentId) throw new Error("Stripe gift payment details are incomplete.");
  let settlement: Awaited<ReturnType<typeof retrieveStripeSettlement>> = null;
  try { settlement = await retrieveStripeSettlement(paymentIntentId); } catch (settlementError) { console.error("Could not retrieve gift settlement", settlementError); }
  const paidAt = new Date().toISOString();
  let fundingEntryId = gift.funding_entry_id as string | null;
  if (!fundingEntryId) {
    const { data: entry, error: entryError } = await supabase.from("business_funding_entries").insert({
      entry_date: paidAt.slice(0, 10), donor_name: gift.donor_name, party_kind: "external", entry_type: "gift_received", amount_cents: gross,
      payment_method: "Stripe", reference: paymentIntentId, note: [gift.donor_message, `Acknowledged ${gift.acknowledgement_version} at ${gift.acknowledged_at}.`].filter(Boolean).join(" — "),
    }).select("id").single();
    if (entryError || !entry) throw new Error("The gift was paid, but could not be added to the gift ledger.");
    fundingEntryId = entry.id;
  }
  await supabase.from("support_gifts").update({
    status: "paid", stripe_checkout_session_id: session.id, stripe_payment_intent_id: paymentIntentId,
    stripe_balance_transaction_id: settlement?.balanceTransactionId ?? null, gross_amount_cents: gross,
    stripe_fee_cents: settlement?.feeCents ?? null, net_amount_cents: settlement?.netCents ?? null,
    paid_at: paidAt, funding_entry_id: fundingEntryId, updated_at: paidAt,
  }).eq("id", giftId);
  if (gift.stripe_payment_link_id) {
    try { await getStripe().paymentLinks.update(gift.stripe_payment_link_id, { active: false }); }
    catch (linkError) { console.error("Could not deactivate completed gift link", linkError); }
  }
  if (alreadyPaid) return;

  const receiptUrl = `${publicSiteUrl()}/gift/receipt/${gift.receipt_token}`;
  const sent = await sendMooreMadeEmail({
    to: gift.donor_email,
    subject: "Thank you for your gift to Moore Made",
    html: emailShell("Thank you for supporting Moore Made", `<p style="line-height:1.65;margin:0 0 14px;">Hi ${escapeHtml(gift.donor_name)}, we received your voluntary gift of <strong>${escapeHtml(money(gross))}</strong>. Your support gives Moore Made more room to strengthen production and build carefully.</p>${giftTermsHtml()}<a href="${escapeHtml(receiptUrl)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:13px 20px;border-radius:999px;font-weight:800;">View gift receipt</a><p style="margin:18px 0 0;color:#6b7280;font-size:12px;line-height:1.5;">Payment ID: ${escapeHtml(paymentIntentId)}</p>`),
  });
  await supabase.from("support_gifts").update(sent.ok ? { receipt_email_sent_at: new Date().toISOString(), receipt_email_error: null } : { receipt_email_error: sent.error }).eq("id", giftId);
}
