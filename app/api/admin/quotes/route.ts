import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { emailShell, escapeHtml, sendMooreMadeEmail, siteUrl } from "@/lib/email";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { money, type QuoteLineItem, type QuoteProofAsset } from "@/lib/quote-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cents(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function normalizeLineItems(value: unknown): QuoteLineItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 500)
    .map((item) => ({
      description: text(item?.description, 500),
      quantity: Math.max(1, Math.floor(Number(item?.quantity) || 1)),
      unitPriceCents: cents(item?.unitPriceCents),
    }))
    .filter((item) => item.description && item.unitPriceCents >= 0);
}

type NormalizedProofItem = {
  title: string;
  notes: string | null;
  assets: QuoteProofAsset[];
};

function normalizeProofItems(value: unknown, requestId: string): NormalizedProofItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).map((item) => {
    const assets = Array.isArray(item?.assets)
      ? item.assets
          .filter((asset: unknown): asset is { path: string; originalName?: string } => Boolean(
            asset &&
            typeof (asset as { path?: unknown }).path === "string" &&
            (asset as { path: string }).path.startsWith(`${requestId}/`)
          ))
          .slice(0, 2000)
          .map((asset: { path: string; originalName?: string }) => ({
            path: asset.path,
            originalName: text(asset.originalName, 300) || null,
          }))
      : [];
    return {
      title: text(item?.title, 300),
      notes: text(item?.notes, 5000) || null,
      assets,
    };
  }).filter((item) => item.title);
}

const QUOTE_SELECT = "id,request_id,public_token,status,line_items,setup_fee_cents,shipping_cents,tax_cents,discount_cents,subtotal_cents,total_cents,payment_terms,deposit_amount_cents,notes,valid_until,proof_paths,proof_notes,proof_version,customer_change_request,sent_at,responded_at,created_at,updated_at";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const requestId = text(body.requestId, 100);
    const action = body.action === "send" ? "send" : "save";
    const lineItems = normalizeLineItems(body.lineItems);
    const proofItems = normalizeProofItems(body.proofItems, requestId);

    if (!requestId || lineItems.length === 0) {
      return NextResponse.json({ error: "Add at least one quote line item." }, { status: 400 });
    }
    if (proofItems.length === 0) {
      return NextResponse.json({ error: "Add at least one product/proof item." }, { status: 400 });
    }
    if (action === "send" && proofItems.some((item) => item.assets.length === 0)) {
      return NextResponse.json({ error: "Every proof item needs at least one mockup/image/PDF before sending." }, { status: 400 });
    }

    const setupFeeCents = cents(body.setupFeeCents);
    const shippingCents = cents(body.shippingCents);
    const taxCents = cents(body.taxCents);
    const discountCents = cents(body.discountCents);
    const subtotalCents = lineItems.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
    const totalCents = Math.max(0, subtotalCents + setupFeeCents + shippingCents + taxCents - discountCents);

    const paymentTerms = body.paymentTerms === "deposit" ? "deposit" : "full";
    const depositAmountCents = paymentTerms === "deposit" ? cents(body.depositAmountCents) : null;
    if (paymentTerms === "deposit" && (!depositAmountCents || depositAmountCents >= totalCents)) {
      return NextResponse.json({ error: "Custom deposit must be greater than $0 and less than the quote total." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: customerRequest, error: requestError } = await supabase
      .from("custom_requests")
      .select("id,request_number,customer_name,email,product,quantity,item_type,colors,sizes,print_sides,placements,deadline,delivery")
      .eq("id", requestId)
      .single();

    if (requestError || !customerRequest) {
      return NextResponse.json({ error: "Custom request not found." }, { status: 404 });
    }

    const { data: existing } = await supabase
      .from("quotes")
      .select("id,status,proof_version,sent_at")
      .eq("request_id", requestId)
      .maybeSingle();

    if (existing?.status === "approved") {
      return NextResponse.json({ error: "This proof + quote is already approved and locked." }, { status: 409 });
    }
    if (existing?.status === "sent") {
      return NextResponse.json({ error: "This version is waiting on the customer. Wait for their response before editing it." }, { status: 409 });
    }

    let highestStoredVersion = 0;
    if (existing?.id) {
      const { data: highest } = await supabase
        .from("quote_proof_items")
        .select("proof_version")
        .eq("quote_id", existing.id)
        .order("proof_version", { ascending: false })
        .limit(1)
        .maybeSingle();
      highestStoredVersion = Number(highest?.proof_version || 0);
    }

    const currentSentVersion = Math.max(1, Number(existing?.proof_version || 1));
    const targetVersion = existing?.status === "changes_requested"
      ? Math.max(currentSentVersion + 1, highestStoredVersion || currentSentVersion + 1)
      : Math.max(currentSentVersion, highestStoredVersion || 1);

    const flattenedProofPaths = proofItems.flatMap((item) => item.assets.map((asset) => asset.path));
    const quotePayload = {
      request_id: requestId,
      line_items: lineItems,
      setup_fee_cents: setupFeeCents,
      shipping_cents: shippingCents,
      tax_cents: taxCents,
      discount_cents: discountCents,
      subtotal_cents: subtotalCents,
      total_cents: totalCents,
      payment_terms: paymentTerms,
      deposit_amount_cents: depositAmountCents,
      notes: text(body.notes, 5000) || null,
      valid_until: text(body.validUntil, 20) || null,
      proof_paths: flattenedProofPaths,
      proof_notes: null,
      proof_version: existing?.status === "changes_requested" ? currentSentVersion : targetVersion,
      status: existing?.status === "changes_requested" ? "changes_requested" : "draft",
    } as Record<string, unknown>;

    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .upsert(quotePayload, { onConflict: "request_id" })
      .select(QUOTE_SELECT)
      .single();

    if (quoteError || !quote) {
      console.error("Proof + quote save failed", quoteError);
      return NextResponse.json({ error: "Could not save this proof and quote." }, { status: 500 });
    }

    // A draft version may be safely replaced. Sent versions are never deleted, which
    // preserves the exact proof a customer previously reviewed.
    const { error: deleteProofError } = await supabase
      .from("quote_proof_items")
      .delete()
      .eq("quote_id", quote.id)
      .eq("proof_version", targetVersion);
    if (deleteProofError) {
      console.error("Old proof draft cleanup failed", deleteProofError);
      return NextResponse.json({ error: "Could not update the proof items." }, { status: 500 });
    }

    const { data: insertedItems, error: itemError } = await supabase
      .from("quote_proof_items")
      .insert(proofItems.map((item, index) => ({
        quote_id: quote.id,
        proof_version: targetVersion,
        title: item.title,
        notes: item.notes,
        sort_order: index,
      })))
      .select("id,sort_order");

    if (itemError || !insertedItems || insertedItems.length !== proofItems.length) {
      console.error("Proof item save failed", itemError);
      return NextResponse.json({ error: "Could not save the product proof items." }, { status: 500 });
    }

    const savedItemRows = insertedItems as Array<{ id: string; sort_order: number }>;
    const itemIdByOrder = new Map(savedItemRows.map((row) => [Number(row.sort_order), row.id]));
    const assetRows = proofItems.flatMap((item, itemIndex) => item.assets.map((asset, assetIndex) => ({
      proof_item_id: itemIdByOrder.get(itemIndex),
      storage_path: asset.path,
      original_filename: asset.originalName || asset.path.split("/").pop() || null,
      sort_order: assetIndex,
    }))).filter((row) => Boolean(row.proof_item_id));

    if (assetRows.length) {
      const { error: assetError } = await supabase.from("quote_proof_assets").insert(assetRows);
      if (assetError) {
        console.error("Proof asset save failed", assetError);
        return NextResponse.json({ error: "Could not save the proof files." }, { status: 500 });
      }
    }

    if (action === "save") {
      return NextResponse.json({ ok: true, quote, proofVersion: targetVersion, message: "Proof + quote draft saved." });
    }

    const reference = formatRequestNumber(customerRequest.request_number);
    const quoteUrl = `${siteUrl()}/quote/${quote.public_token}`;
    const lineRows = lineItems
      .map((item) => `<tr><td style="padding:8px 12px 8px 0;">${escapeHtml(item.description)}</td><td style="padding:8px 12px;text-align:center;">${item.quantity}</td><td style="padding:8px 0;text-align:right;font-weight:700;">${escapeHtml(money(item.quantity * item.unitPriceCents))}</td></tr>`)
      .join("");

    const extraRows = [
      setupFeeCents ? `<tr><td colspan="2" style="padding:6px 12px 6px 0;color:#6b6b6b;">Setup fee</td><td style="padding:6px 0;text-align:right;font-weight:700;">${escapeHtml(money(setupFeeCents))}</td></tr>` : "",
      shippingCents ? `<tr><td colspan="2" style="padding:6px 12px 6px 0;color:#6b6b6b;">Shipping</td><td style="padding:6px 0;text-align:right;font-weight:700;">${escapeHtml(money(shippingCents))}</td></tr>` : "",
      taxCents ? `<tr><td colspan="2" style="padding:6px 12px 6px 0;color:#6b6b6b;">Tax</td><td style="padding:6px 0;text-align:right;font-weight:700;">${escapeHtml(money(taxCents))}</td></tr>` : "",
      discountCents ? `<tr><td colspan="2" style="padding:6px 12px 6px 0;color:#6b6b6b;">Discount</td><td style="padding:6px 0;text-align:right;font-weight:700;">−${escapeHtml(money(discountCents))}</td></tr>` : "",
    ].join("");

    const proofSummary = proofItems.map((item) => `<li style="margin:0 0 5px;">${escapeHtml(item.title)} — ${item.assets.length} file${item.assets.length === 1 ? "" : "s"}</li>`).join("");

    const paymentSummary = paymentTerms === "deposit"
      ? `<div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:14px 16px;margin:0 0 18px;"><strong>Payment after approval</strong><p style="line-height:1.6;margin:7px 0 0;">Custom deposit due: <strong>${escapeHtml(money(depositAmountCents || 0))}</strong><br>Remaining balance: <strong>${escapeHtml(money(Math.max(0, totalCents - (depositAmountCents || 0))))}</strong></p></div>`
      : `<div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:14px 16px;margin:0 0 18px;"><strong>Payment after approval</strong><p style="line-height:1.6;margin:7px 0 0;">Full payment of <strong>${escapeHtml(money(totalCents))}</strong> is required to begin production.</p></div>`;

    const emailResult = await sendMooreMadeEmail({
      to: customerRequest.email,
      subject: `Your Moore Made proof + quote is ready — ${reference}`,
      replyTo: process.env.MOORE_MADE_ADMIN_EMAIL,
      html: emailShell(
        `Your proof + quote is ready — ${reference}`,
        `<p style="line-height:1.65;margin:0 0 16px;">Hi ${escapeHtml(customerRequest.customer_name)}, we&apos;ve prepared the mockups and pricing for your custom order.</p>
         <p style="line-height:1.65;margin:0 0 18px;">Review <strong>every product proof, the order details, and the quote together</strong>. If everything looks right, approve the entire order in one step. If something needs to change, you can identify the specific product from the same page.</p>
         <div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:14px 16px;margin:0 0 18px;"><strong>Proof set</strong><ul style="margin:8px 0 0;padding-left:20px;line-height:1.55;">${proofSummary}</ul></div>
         <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
           <thead><tr style="border-bottom:1px solid #ded9d1;"><th style="text-align:left;padding:8px 12px 8px 0;">Item</th><th style="padding:8px 12px;">Qty</th><th style="text-align:right;padding:8px 0;">Total</th></tr></thead>
           <tbody>${lineRows}${extraRows}</tbody>
         </table>
         <p style="font-size:22px;margin:0 0 12px;"><strong>Total: ${escapeHtml(money(totalCents))}</strong></p>
         ${paymentSummary}
         <p style="color:#6b6b6b;font-size:13px;margin:0 0 20px;">Proof version ${targetVersion} · ${proofItems.length} product/proof item${proofItems.length === 1 ? "" : "s"} · ${flattenedProofPaths.length} total file${flattenedProofPaths.length === 1 ? "" : "s"}</p>
         <a href="${quoteUrl}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:13px 19px;border-radius:999px;font-weight:800;">Review proof + quote</a>
         <p style="line-height:1.6;color:#6b6b6b;font-size:13px;margin:18px 0 0;">Approving confirms every displayed mockup, the quoted order details, and the payment terms. Secure payment is presented after approval.</p>`
      ),
    });

    if (!emailResult.ok) {
      return NextResponse.json(
        { error: `The proof and quote were saved as a draft, but the email could not be sent. ${emailResult.error}`, quote },
        { status: 502 }
      );
    }

    const now = new Date().toISOString();
    const { data: sentQuote, error: sentError } = await supabase
      .from("quotes")
      .update({ status: "sent", sent_at: now, responded_at: null, customer_change_request: null, proof_version: targetVersion })
      .eq("id", quote.id)
      .select(QUOTE_SELECT)
      .single();

    if (sentError) console.error("Proof + quote sent status update failed", sentError);
    await supabase.from("custom_requests").update({ status: "quote_sent" }).eq("id", requestId);

    return NextResponse.json({
      ok: true,
      quote: sentQuote ?? { ...quote, status: "sent", sent_at: now, proof_version: targetVersion },
      message: "Proof + quote emailed for approval.",
      quoteUrl,
    });
  } catch (error) {
    console.error("Proof + quote route failed", error);
    return NextResponse.json({ error: "Could not save this proof and quote." }, { status: 500 });
  }
}
