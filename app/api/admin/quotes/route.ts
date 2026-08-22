import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { emailShell, escapeHtml, publicSiteUrl, sendMooreMadeEmail } from "@/lib/email";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { money, type QuoteLineItem, type QuoteProofAsset } from "@/lib/quote-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { validateDiscountCode } from "@/lib/discount-server";
import { normalizeDiscountCode } from "@/lib/discount-types";
import { expirePendingCheckoutSessionsForQuote } from "@/lib/payment-server";
import { recordCustomerEmailNotification } from "@/lib/message-server";

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

const QUOTE_SELECT = "id,request_id,public_token,status,line_items,setup_fee_cents,shipping_cents,tax_cents,tax_mode,stripe_tax_calculation_id,tax_calculated_at,tax_exempt_reason,tax_breakdown,tax_input_fingerprint,discount_cents,manual_discount_cents,promo_discount_cents,discount_code_id,applied_discount_code,subtotal_cents,total_cents,payment_terms,deposit_amount_cents,internal_supply_cost_cents,internal_print_cost_cents,internal_packaging_cost_cents,internal_shipping_cost_cents,internal_payment_fee_cents,internal_other_cost_cents,labor_hours,labor_rate_cents,labor_cost_cents,internal_total_cost_cents,estimated_profit_cents,estimated_margin_basis_points,revision_number,revision_reason,notes,valid_until,proof_paths,proof_notes,proof_version,customer_change_request,mockup_snapshot,sent_at,responded_at,created_at,updated_at";

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
    const setupFeeCents = cents(body.setupFeeCents);
    const shippingCents = cents(body.shippingCents);
    const taxMode = body.taxMode === "automatic" ? "automatic" : body.taxMode === "exempt" ? "exempt" : "manual";
    const taxExemptReason = text(body.taxExemptReason, 1000);
    const stripeTaxCalculationId = taxMode === "automatic" ? text(body.stripeTaxCalculationId, 200) : "";
    const taxCalculatedAt = taxMode === "automatic" ? text(body.taxCalculatedAt, 100) : "";
    const taxInputFingerprint = taxMode === "automatic" ? text(body.taxInputFingerprint, 5000) : "";
    const taxBreakdown = taxMode === "automatic" && body.taxBreakdown && typeof body.taxBreakdown === "object" ? body.taxBreakdown : null;
    let taxCents = taxMode === "exempt" ? 0 : cents(body.taxCents);
    if (taxMode === "exempt" && taxExemptReason.length < 3) {
      return NextResponse.json({ error: "Add a reason/document note when marking a customer tax exempt." }, { status: 400 });
    }
    if (action === "send" && taxMode === "automatic" && (!stripeTaxCalculationId || !taxCalculatedAt || !taxInputFingerprint)) {
      return NextResponse.json({ error: "Recalculate automatic tax before saving this quote." }, { status: 400 });
    }
    const manualDiscountCents = cents(body.manualDiscountCents ?? body.discountCents);
    const subtotalCents = lineItems.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
    const eligibleDiscountCents = subtotalCents + setupFeeCents;

    const paymentTerms = body.paymentTerms === "deposit" ? "deposit" : "full";
    const revisionReason = text(body.revisionReason, 500);
    const supabase = getSupabaseAdmin();
    const { data: customerRequest, error: requestError } = await supabase
      .from("custom_requests")
      .select("id,request_number,customer_name,email,product,quantity,item_type,colors,sizes,print_sides,placements,deadline,delivery")
      .eq("id", requestId)
      .single();

    if (requestError || !customerRequest) {
      return NextResponse.json({ error: "Custom request not found." }, { status: 404 });
    }

    let mockupSnapshot: unknown | null = null;
    if (body.includeSavedMockup !== false) {
      const { data: mockupProject, error: mockupError } = await supabase
        .from("mockup_projects")
        .select("document")
        .eq("request_id", requestId)
        .neq("status", "archived")
        .maybeSingle();
      if (mockupError && mockupError.code !== "PGRST116") {
        console.error("Quote mockup snapshot lookup failed", mockupError);
      } else {
        mockupSnapshot = mockupProject?.document || null;
      }
    }

    if (action === "send") {
      const firstProofCanUseSavedMockup = Boolean(mockupSnapshot);
      const missingProof = proofItems.find((item, index) => item.assets.length === 0 && !(index === 0 && firstProofCanUseSavedMockup));
      if (missingProof) {
        return NextResponse.json({ error: `Add a proof file for ${missingProof.title}. The primary proof can use the saved customer mockup when available.` }, { status: 400 });
      }
      if (!mockupSnapshot && !proofItems.some((item) => item.assets.length > 0)) {
        return NextResponse.json({ error: "Attach a saved mockup or upload at least one final proof before sending." }, { status: 400 });
      }
    }

    const normalizedCode = normalizeDiscountCode(text(body.discountCode, 80));
    let promoDiscountCents = 0;
    let discountCodeId: string | null = null;

    const laborHours = Math.max(1, Number(body.laborHours) || 1);
    const laborRateCents = cents(body.laborRateCents || 1000);
    const laborCostCents = Math.round(laborHours * laborRateCents);
    const internalSupplyCostCents = cents(body.internalSupplyCostCents);
    const internalPrintCostCents = cents(body.internalPrintCostCents);
    const internalPackagingCostCents = cents(body.internalPackagingCostCents);
    const internalShippingCostCents = cents(body.internalShippingCostCents);
    const internalPaymentFeeCents = cents(body.internalPaymentFeeCents);
    const internalOtherCostCents = cents(body.internalOtherCostCents);
    const internalTotalCostCents = internalSupplyCostCents + internalPrintCostCents + internalPackagingCostCents + internalShippingCostCents + internalPaymentFeeCents + internalOtherCostCents + laborCostCents;

    const { data: existing } = await supabase
      .from("quotes")
      .select(QUOTE_SELECT)
      .eq("request_id", requestId)
      .maybeSingle();

    if (existing?.status === "approved" && (action !== "send" || revisionReason.length < 3)) {
      return NextResponse.json({ error: "Approved quotes can only be changed by sending a new revision with a reason." }, { status: 409 });
    }
    if (existing?.status === "sent") {
      return NextResponse.json({ error: "This version is waiting on the customer. Wait for their response before editing it." }, { status: 409 });
    }

    if (normalizedCode) {
      try {
        const validated = await validateDiscountCode(supabase, { code: normalizedCode, eligibleCents: eligibleDiscountCents, customerEmail: customerRequest.email, quoteId: existing?.id || null });
        promoDiscountCents = validated.discountCents;
        discountCodeId = validated.code?.id || null;
      } catch (discountError) {
        return NextResponse.json({ error: discountError instanceof Error ? discountError.message : "That discount code could not be applied." }, { status: 400 });
      }
    }

    const finalDiscountCents = Math.min(eligibleDiscountCents, manualDiscountCents + promoDiscountCents);
    const finalTotalCents = Math.max(0, subtotalCents + setupFeeCents + shippingCents + taxCents - finalDiscountCents);
    const finalRevenueBeforeTaxCents = Math.max(0, subtotalCents + setupFeeCents + shippingCents - finalDiscountCents);
    const finalEstimatedProfitCents = finalRevenueBeforeTaxCents - internalTotalCostCents;
    const finalEstimatedMarginBasisPoints = finalRevenueBeforeTaxCents > 0 ? Math.round((finalEstimatedProfitCents / finalRevenueBeforeTaxCents) * 10000) : 0;
    const depositAmountCents = paymentTerms === "deposit" ? cents(body.depositAmountCents) : null;
    if (paymentTerms === "deposit" && (!depositAmountCents || depositAmountCents >= finalTotalCents)) {
      return NextResponse.json({ error: "Custom deposit must be greater than $0 and less than the quote total." }, { status: 400 });
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
    const needsNewProofVersion = Boolean(existing && ["approved", "changes_requested", "declined", "expired"].includes(existing.status));
    const targetVersion = needsNewProofVersion
      ? Math.max(currentSentVersion + 1, highestStoredVersion + 1, currentSentVersion + 1)
      : Math.max(currentSentVersion, highestStoredVersion || 1);
    const currentRevisionNumber = Math.max(1, Number(existing?.revision_number || 1));
    const needsNewRevision = Boolean(existing && action === "send" && ["approved", "changes_requested", "declined", "expired"].includes(existing.status));
    const targetRevisionNumber = needsNewRevision ? currentRevisionNumber + 1 : currentRevisionNumber;

    // Preserve the customer-facing version before an admin-initiated/new revision replaces it.
    if (existing?.id && needsNewRevision) {
      const { data: priorRevision } = await supabase
        .from("quote_revisions")
        .select("id")
        .eq("quote_id", existing.id)
        .eq("revision_number", currentRevisionNumber)
        .maybeSingle();
      if (!priorRevision) {
        const { error: priorRevisionError } = await supabase.from("quote_revisions").insert({
          quote_id: existing.id,
          revision_number: currentRevisionNumber,
          status: existing.status,
          revision_reason: existing.revision_reason || null,
          line_items: existing.line_items || [],
          setup_fee_cents: Number(existing.setup_fee_cents || 0),
          shipping_cents: Number(existing.shipping_cents || 0),
          tax_cents: Number(existing.tax_cents || 0),
          manual_discount_cents: Number(existing.manual_discount_cents ?? existing.discount_cents ?? 0),
          promo_discount_cents: Number(existing.promo_discount_cents || 0),
          discount_cents: Number(existing.discount_cents || 0),
          applied_discount_code: existing.applied_discount_code || null,
          subtotal_cents: Number(existing.subtotal_cents || 0),
          total_cents: Number(existing.total_cents || 0),
          payment_terms: existing.payment_terms === "deposit" ? "deposit" : "full",
          deposit_amount_cents: existing.deposit_amount_cents || null,
          internal_supply_cost_cents: Number(existing.internal_supply_cost_cents || 0),
          internal_print_cost_cents: Number(existing.internal_print_cost_cents || 0),
          internal_packaging_cost_cents: Number(existing.internal_packaging_cost_cents || 0),
          internal_shipping_cost_cents: Number(existing.internal_shipping_cost_cents || 0),
          internal_payment_fee_cents: Number(existing.internal_payment_fee_cents || 0),
          internal_other_cost_cents: Number(existing.internal_other_cost_cents || 0),
          labor_hours: Number(existing.labor_hours || 0),
          labor_rate_cents: Number(existing.labor_rate_cents || 1000),
          labor_cost_cents: Number(existing.labor_cost_cents || 0),
          internal_total_cost_cents: Number(existing.internal_total_cost_cents || 0),
          estimated_profit_cents: Number(existing.estimated_profit_cents || 0),
          estimated_margin_basis_points: Number(existing.estimated_margin_basis_points || 0),
          proof_version: Number(existing.proof_version || 1),
          sent_at: existing.sent_at || null,
          responded_at: existing.responded_at || null,
          mockup_snapshot: existing.mockup_snapshot || null,
        });
        if (priorRevisionError) {
          console.error("Prior quote revision snapshot failed", priorRevisionError);
          return NextResponse.json({ error: "Could not preserve the previous quote revision." }, { status: 500 });
        }
      }
    }

    const flattenedProofPaths = proofItems.flatMap((item) => item.assets.map((asset) => asset.path));
    const quotePayload = {
      request_id: requestId,
      line_items: lineItems,
      setup_fee_cents: setupFeeCents,
      shipping_cents: shippingCents,
      tax_cents: taxCents,
      tax_mode: taxMode,
      stripe_tax_calculation_id: stripeTaxCalculationId || null,
      tax_calculated_at: taxCalculatedAt || null,
      tax_exempt_reason: taxMode === "exempt" ? taxExemptReason : null,
      tax_breakdown: taxBreakdown,
      tax_input_fingerprint: taxInputFingerprint || null,
      discount_cents: finalDiscountCents,
      manual_discount_cents: manualDiscountCents,
      promo_discount_cents: promoDiscountCents,
      discount_code_id: discountCodeId,
      applied_discount_code: normalizedCode || null,
      subtotal_cents: subtotalCents,
      total_cents: finalTotalCents,
      payment_terms: paymentTerms,
      deposit_amount_cents: depositAmountCents,
      internal_supply_cost_cents: internalSupplyCostCents,
      internal_print_cost_cents: internalPrintCostCents,
      internal_packaging_cost_cents: internalPackagingCostCents,
      internal_shipping_cost_cents: internalShippingCostCents,
      internal_payment_fee_cents: internalPaymentFeeCents,
      internal_other_cost_cents: internalOtherCostCents,
      labor_hours: laborHours,
      labor_rate_cents: laborRateCents,
      labor_cost_cents: laborCostCents,
      internal_total_cost_cents: internalTotalCostCents,
      estimated_profit_cents: finalEstimatedProfitCents,
      estimated_margin_basis_points: finalEstimatedMarginBasisPoints,
      revision_number: action === "send" ? targetRevisionNumber : currentRevisionNumber,
      revision_reason: needsNewRevision ? revisionReason : existing?.revision_reason || null,
      notes: text(body.notes, 5000) || null,
      valid_until: text(body.validUntil, 20) || null,
      proof_paths: flattenedProofPaths,
      proof_notes: null,
      mockup_snapshot: mockupSnapshot,
      proof_version: needsNewProofVersion ? currentSentVersion : targetVersion,
      status: existing?.status === "changes_requested" ? "changes_requested" : existing?.status === "approved" ? "approved" : "draft",
    } as Record<string, unknown>;

    let quote: Record<string, any> | null = null;
    const preserveApprovedUntilSent = existing?.status === "approved" && action === "send";
    if (preserveApprovedUntilSent) {
      quote = { ...existing, ...quotePayload, id: existing.id, public_token: existing.public_token };
    } else {
      const { data: savedQuote, error: quoteError } = await supabase
        .from("quotes")
        .upsert(quotePayload, { onConflict: "request_id" })
        .select(QUOTE_SELECT)
        .single();
      if (quoteError || !savedQuote) {
        console.error("Proof + quote save failed", quoteError);
        return NextResponse.json({ error: "Could not save this proof and quote." }, { status: 500 });
      }
      quote = savedQuote;
    }

    if (!quote) return NextResponse.json({ error: "Could not save this proof and quote." }, { status: 500 });

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
    const quoteUrl = `${publicSiteUrl()}/quote/${quote.public_token}`;
    const fulfillmentChargeLabel = String(customerRequest.delivery || "").toLowerCase().includes("delivery")
      ? "Local delivery"
      : String(customerRequest.delivery || "").toLowerCase().includes("ship")
        ? "Shipping"
        : "Fulfillment";
    const lineRows = lineItems
      .map((item) => `<tr><td style="padding:8px 12px 8px 0;">${escapeHtml(item.description)}</td><td style="padding:8px 12px;text-align:center;">${item.quantity}</td><td style="padding:8px 0;text-align:right;font-weight:700;">${escapeHtml(money(item.quantity * item.unitPriceCents))}</td></tr>`)
      .join("");

    const extraRows = [
      setupFeeCents ? `<tr><td colspan="2" style="padding:6px 12px 6px 0;color:#6b6b6b;">Setup fee</td><td style="padding:6px 0;text-align:right;font-weight:700;">${escapeHtml(money(setupFeeCents))}</td></tr>` : "",
      shippingCents ? `<tr><td colspan="2" style="padding:6px 12px 6px 0;color:#6b6b6b;">${escapeHtml(fulfillmentChargeLabel)}</td><td style="padding:6px 0;text-align:right;font-weight:700;">${escapeHtml(money(shippingCents))}</td></tr>` : "",
      taxCents ? `<tr><td colspan="2" style="padding:6px 12px 6px 0;color:#6b6b6b;">Tax</td><td style="padding:6px 0;text-align:right;font-weight:700;">${escapeHtml(money(taxCents))}</td></tr>` : "",
      finalDiscountCents ? `<tr><td colspan="2" style="padding:6px 12px 6px 0;color:#6b6b6b;">Discount</td><td style="padding:6px 0;text-align:right;font-weight:700;">−${escapeHtml(money(finalDiscountCents))}</td></tr>` : "",
    ].join("");

    const proofSummary = proofItems.map((item, index) => {
      const savedMockupLabel = index === 0 && mockupSnapshot ? "saved mockup" : "";
      const fileLabel = item.assets.length ? `${item.assets.length} file${item.assets.length === 1 ? "" : "s"}` : "";
      const detail = [savedMockupLabel, fileLabel].filter(Boolean).join(" + ") || "proof details";
      return `<li style="margin:0 0 5px;">${escapeHtml(item.title)} — ${escapeHtml(detail)}</li>`;
    }).join("");

    const paymentSummary = paymentTerms === "deposit"
      ? `<div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:14px 16px;margin:0 0 18px;"><strong>Payment after approval</strong><p style="line-height:1.6;margin:7px 0 0;">Custom deposit due: <strong>${escapeHtml(money(depositAmountCents || 0))}</strong><br>Remaining balance: <strong>${escapeHtml(money(Math.max(0, finalTotalCents - (depositAmountCents || 0))))}</strong></p></div>`
      : `<div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:14px 16px;margin:0 0 18px;"><strong>Payment after approval</strong><p style="line-height:1.6;margin:7px 0 0;">Full payment of <strong>${escapeHtml(money(finalTotalCents))}</strong> is required to begin production.</p></div>`;

    const emailResult = await sendMooreMadeEmail({
      to: customerRequest.email,
      subject: `${needsNewRevision ? "Updated Moore Made proof + quote" : "Your Moore Made proof + quote is ready"} — ${reference}`,
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
         <p style="font-size:22px;margin:0 0 12px;"><strong>Total: ${escapeHtml(money(finalTotalCents))}</strong></p>
         ${paymentSummary}
         <p style="color:#6b6b6b;font-size:13px;margin:0 0 20px;">Proof version ${targetVersion} · ${proofItems.length} product/proof item${proofItems.length === 1 ? "" : "s"}${mockupSnapshot ? " · saved mockup attached" : ""}${flattenedProofPaths.length ? ` · ${flattenedProofPaths.length} uploaded file${flattenedProofPaths.length === 1 ? "" : "s"}` : ""}</p>
         <a href="${quoteUrl}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:13px 19px;border-radius:999px;font-weight:800;">Review proof + quote</a>
         <div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:12px 14px;margin:16px 0 0;font-size:12px;line-height:1.55;color:#6b6b6b;word-break:break-all;"><strong style="color:#171717;">If the button does not open:</strong><br>Tap or copy this link into Safari/Chrome:<br><a href="${quoteUrl}" style="color:#171717;">${quoteUrl}</a></div>
         <p style="line-height:1.6;color:#6b6b6b;font-size:13px;margin:18px 0 0;">Approving confirms every displayed mockup, the quoted order details, and the payment terms. Secure payment is presented after approval.</p>`
      ),
    });

    if (!emailResult.ok) {
      if (preserveApprovedUntilSent) {
        await supabase.from("quote_proof_items").delete().eq("quote_id", quote.id).eq("proof_version", targetVersion);
      }
      return NextResponse.json(
        { error: preserveApprovedUntilSent ? "The approved quote was left unchanged because the revised-quote email could not be sent. Check Resend and try again." : "The proof and quote were saved as a draft, but the email could not be sent. Check Resend and try again.", quote },
        { status: 502 }
      );
    }

    const now = new Date().toISOString();
    const { data: sentQuote, error: sentError } = await supabase
      .from("quotes")
      .update({ ...quotePayload, status: "sent", sent_at: now, responded_at: null, customer_change_request: null, proof_version: targetVersion, revision_number: targetRevisionNumber, revision_reason: needsNewRevision ? revisionReason : quote.revision_reason || null })
      .eq("id", quote.id)
      .select(QUOTE_SELECT)
      .single();

    if (sentError) console.error("Proof + quote sent status update failed", sentError);

    const revisionSnapshot = sentQuote ?? { ...quote, status: "sent", sent_at: now, proof_version: targetVersion, revision_number: targetRevisionNumber, revision_reason: needsNewRevision ? revisionReason : quote.revision_reason || null };
    const { error: revisionError } = await supabase.from("quote_revisions").upsert({
      quote_id: quote.id,
      revision_number: targetRevisionNumber,
      status: "sent",
      revision_reason: revisionSnapshot.revision_reason || null,
      line_items: lineItems,
      setup_fee_cents: setupFeeCents,
      shipping_cents: shippingCents,
      tax_cents: taxCents,
      manual_discount_cents: manualDiscountCents,
      promo_discount_cents: promoDiscountCents,
      discount_cents: finalDiscountCents,
      applied_discount_code: normalizedCode || null,
      subtotal_cents: subtotalCents,
      total_cents: finalTotalCents,
      payment_terms: paymentTerms,
      deposit_amount_cents: depositAmountCents,
      internal_supply_cost_cents: internalSupplyCostCents,
      internal_print_cost_cents: internalPrintCostCents,
      internal_packaging_cost_cents: internalPackagingCostCents,
      internal_shipping_cost_cents: internalShippingCostCents,
      internal_payment_fee_cents: internalPaymentFeeCents,
      internal_other_cost_cents: internalOtherCostCents,
      labor_hours: laborHours,
      labor_rate_cents: laborRateCents,
      labor_cost_cents: laborCostCents,
      internal_total_cost_cents: internalTotalCostCents,
      estimated_profit_cents: finalEstimatedProfitCents,
      estimated_margin_basis_points: finalEstimatedMarginBasisPoints,
      proof_version: targetVersion,
      sent_at: now,
      responded_at: null,
      mockup_snapshot: mockupSnapshot,
    }, { onConflict: "quote_id,revision_number" });
    if (revisionError) console.error("Quote revision history save failed", revisionError);

    // A revised approved quote must invalidate any old unpaid Stripe Checkout page
    // so the customer cannot accidentally pay a stale amount.
    if (needsNewRevision) {
      try {
        await expirePendingCheckoutSessionsForQuote(quote.id);
      } catch (expireError) {
        console.error("Stale Stripe checkout cleanup failed", expireError);
      }
      const { error: linkRevokeError } = await supabase.from("payment_share_links").update({ active: false, revoked_at: now }).eq("quote_id", quote.id).eq("active", true);
      if (linkRevokeError) console.error("Old shared payment link cleanup failed", linkRevokeError);
    }

    await supabase.from("custom_requests").update({ status: "quote_sent" }).eq("id", requestId);
    await recordCustomerEmailNotification({
      requestId,
      recipientEmails: customerRequest.email,
      subject: `${needsNewRevision ? "Updated Moore Made proof + quote" : "Your Moore Made proof + quote is ready"} — ${reference}`,
      body: `Your proof + quote is ready to review. Total: ${money(finalTotalCents)}. Proof version ${targetVersion}.`,
      topic: "order",
      label: "Proof + quote email sent",
    });

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
