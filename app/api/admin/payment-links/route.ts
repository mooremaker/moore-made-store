import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { emailShell, escapeHtml, sendMooreMadeEmail, siteUrl } from "@/lib/email";
import { hashPaymentShareToken, newPaymentShareToken } from "@/lib/payment-share";
import { FINAL_SALE_POLICY_VERSION } from "@/lib/payment-policy";
import { nextPaymentAmount, type PaymentTerms } from "@/lib/payment-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmails(value: unknown) {
  const raw = Array.isArray(value) ? value.map((item) => text(item, 320)) : text(value, 3200).split(/[;,\n]+/);
  return [...new Set(raw.map((item) => item.trim().toLowerCase()).filter((item) => item && validEmail(item)))].slice(0, 10);
}

function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.max(0, cents) / 100);
}

async function loadPayableQuote(requestId: string, quoteId: string) {
  const supabase = getSupabaseAdmin();
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id,status,request_id,total_cents,payment_terms,deposit_amount_cents,proof_version")
    .eq("id", quoteId)
    .single();

  if (quoteError || !quote || quote.request_id !== requestId) {
    return { ok: false as const, status: 404, error: "Quote not found." };
  }
  if (quote.status !== "approved") {
    return { ok: false as const, status: 409, error: "Approve the quote before sharing a payment link." };
  }

  const proofVersion = Math.max(1, Number(quote.proof_version || 1));
  const { data: policy } = await supabase
    .from("order_policy_acceptances")
    .select("id")
    .eq("quote_id", quote.id)
    .eq("proof_version", proofVersion)
    .eq("policy_version", FINAL_SALE_POLICY_VERSION)
    .maybeSingle();

  if (!policy) {
    return { ok: false as const, status: 409, error: "The customer must accept the final-sale terms before a payment link is sent." };
  }

  const { data: order, error: orderError } = await supabase
    .from("custom_requests")
    .select("id,request_number,customer_name,email,product")
    .eq("id", requestId)
    .single();

  if (orderError || !order) {
    return { ok: false as const, status: 404, error: "Order not found." };
  }

  const { data: paidRows } = await supabase
    .from("payments")
    .select("amount_cents,status")
    .eq("quote_id", quote.id);

  const amountPaid = (paidRows ?? [])
    .filter((row) => row.status === "paid")
    .reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);

  const next = nextPaymentAmount({
    totalCents: Number(quote.total_cents || 0),
    terms: (quote.payment_terms === "deposit" ? "deposit" : "full") as PaymentTerms,
    depositAmountCents: quote.deposit_amount_cents,
    amountPaidCents: amountPaid,
  });

  if (!next.kind || next.amountCents <= 0) {
    return { ok: false as const, status: 409, error: "This order is already paid in full." };
  }

  return { ok: true as const, quote, order, amountPaid, next };
}

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const quoteId = new URL(request.url).searchParams.get("quoteId") || "";
  if (!quoteId) return NextResponse.json({ error: "Quote is required." }, { status: 400 });
  const { data, error } = await getSupabaseAdmin()
    .from("payment_share_links")
    .select("id,request_id,quote_id,label,active,expires_at,revoked_at,recipient_email,emailed_at,email_status,created_at")
    .eq("quote_id", quoteId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Payment links are not available yet." }, { status: 500 });
  return NextResponse.json({ ok: true, links: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const action = text(body.action, 40) || "create";
    const supabase = getSupabaseAdmin();

    if (action === "revoke") {
      const linkId = text(body.linkId, 100);
      if (!linkId) return NextResponse.json({ error: "Link is required." }, { status: 400 });
      const { error } = await supabase
        .from("payment_share_links")
        .update({ active: false, revoked_at: new Date().toISOString() })
        .eq("id", linkId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "revoke-all") {
      const quoteId = text(body.quoteId, 100);
      if (!quoteId) return NextResponse.json({ error: "Quote is required." }, { status: 400 });
      const { error } = await supabase
        .from("payment_share_links")
        .update({ active: false, revoked_at: new Date().toISOString() })
        .eq("quote_id", quoteId)
        .eq("active", true);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    const requestId = text(body.requestId, 100);
    const quoteId = text(body.quoteId, 100);
    if (!requestId || !quoteId) return NextResponse.json({ error: "Order and quote are required." }, { status: 400 });

    const payable = await loadPayableQuote(requestId, quoteId);
    if (!payable.ok) return NextResponse.json({ error: payable.error }, { status: payable.status });

    if (action === "email") {
      const recipients = normalizeEmails(body.recipientEmails);
      if (!recipients.length) {
        return NextResponse.json({ error: "Enter at least one valid email address." }, { status: 400 });
      }

      const reference = formatRequestNumber(payable.order.request_number);
      const sent: string[] = [];
      const failed: { email: string; error: string }[] = [];

      for (const recipient of recipients) {
        const token = newPaymentShareToken();
        const tokenHash = hashPaymentShareToken(token);
        const payUrl = `${siteUrl()}/pay/${token}`;
        const label = `${reference} payment email · ${recipient}`;
        const { data: created, error: insertError } = await supabase
          .from("payment_share_links")
          .insert({
            request_id: requestId,
            quote_id: quoteId,
            token_hash: tokenHash,
            label,
            recipient_email: recipient,
            active: true,
            created_by: auth.user.id,
          })
          .select("id")
          .single();

        if (insertError || !created) {
          failed.push({ email: recipient, error: "Could not create secure link." });
          continue;
        }

        const html = emailShell(
          `Secure payment link for ${reference}`,
          `<p style="font-size:15px;line-height:1.7;margin:0 0 16px;">Moore Made has sent you a secure payment link for an approved custom order belonging to <strong>${escapeHtml(payable.order.customer_name)}</strong>.</p>
          <div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:14px;padding:16px;margin:0 0 18px;line-height:1.65;">
            <div><strong>Order:</strong> ${escapeHtml(reference)}</div>
            <div><strong>Product:</strong> ${escapeHtml(payable.order.product)}</div>
            <div><strong>Amount due now:</strong> ${escapeHtml(dollars(payable.next.amountCents))}</div>
          </div>
          <p style="font-size:14px;line-height:1.65;margin:0 0 18px;">You can pay this order on the customer's behalf. Your payer name and email will be recorded separately, so the order itself remains under ${escapeHtml(payable.order.customer_name)}.</p>
          <p style="margin:22px 0;"><a href="${escapeHtml(payUrl)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;font-weight:800;padding:13px 20px;border-radius:999px;">Pay securely with card</a></p>
          <p style="font-size:12px;line-height:1.6;color:#6f675f;margin:0;">This link is unique to this order. Card checkout is handled securely by Stripe. If you were not expecting this payment request, you can ignore this email.</p>`
        );

        const emailResult = await sendMooreMadeEmail({
          to: recipient,
          subject: `Secure payment link · ${reference} · Moore Made`,
          html,
          replyTo: process.env.MOORE_MADE_ADMIN_EMAIL,
        });

        if (emailResult.ok) {
          await supabase
            .from("payment_share_links")
            .update({
              emailed_at: new Date().toISOString(),
              email_status: "sent",
              email_message_id: emailResult.id,
            })
            .eq("id", created.id);
          sent.push(recipient);
        } else {
          await supabase
            .from("payment_share_links")
            .update({
              active: false,
              revoked_at: new Date().toISOString(),
              email_status: "failed",
            })
            .eq("id", created.id);
          failed.push({ email: recipient, error: emailResult.error || "Email could not be sent." });
        }
      }

      if (!sent.length) {
        return NextResponse.json({ error: failed[0]?.error || "Could not send the payment email.", sent, failed }, { status: 502 });
      }
      return NextResponse.json({ ok: true, sent, failed });
    }

    const label = text(body.label, 300) || "Shared payment link";
    const token = newPaymentShareToken();
    const tokenHash = hashPaymentShareToken(token);
    const { data: created, error } = await supabase
      .from("payment_share_links")
      .insert({
        request_id: requestId,
        quote_id: quoteId,
        token_hash: tokenHash,
        label,
        active: true,
        created_by: auth.user.id,
      })
      .select("id,created_at")
      .single();
    if (error || !created) throw error || new Error("Could not create link");

    return NextResponse.json({ ok: true, id: created.id, url: `${siteUrl()}/pay/${token}`, createdAt: created.created_at });
  } catch (error) {
    console.error("Payment share link action failed", error);
    return NextResponse.json({ error: "Could not update the payment link." }, { status: 500 });
  }
}
