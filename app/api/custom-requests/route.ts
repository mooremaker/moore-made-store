import { NextResponse } from "next/server";
import { CUSTOM_REQUEST_BUCKET, getSupabaseAdmin } from "@/lib/supabase-admin";
import { emailShell, escapeHtml, sendMooreMadeEmail, siteUrl } from "@/lib/email";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { orderItemsQuantity, type ShippingAddress, type StructuredOrderItem } from "@/lib/order-types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordCustomerEmailNotification } from "@/lib/message-server";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_QUANTITY = 1_000_000;

function text(value: unknown, max = 4000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}


function normalizeOrderItems(value: unknown): StructuredOrderItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((raw, index) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const quantitiesRaw = row.quantities && typeof row.quantities === "object" ? row.quantities as Record<string, unknown> : {};
    const quantities: Record<string, number> = {};
    for (const [size, qty] of Object.entries(quantitiesRaw).slice(0, 40)) {
      const safeSize = text(size, 80);
      const n = Math.max(0, Math.min(100000, Math.floor(Number(qty) || 0)));
      if (safeSize) quantities[safeSize] = n;
    }
    return {
      id: text(row.id, 120) || `item-${index + 1}`,
      productSlug: text(row.productSlug, 160),
      productName: text(row.productName, 300),
      colorName: text(row.colorName, 160),
      customItemType: text(row.customItemType, 300) || undefined,
      customColorNotes: text(row.customColorNotes, 500) || undefined,
      quantities,
      notes: text(row.notes, 2000) || undefined,
      designRelationship: row.designRelationship === "primary" || row.designRelationship === "separate" ? row.designRelationship : "same",
    } satisfies StructuredOrderItem;
  }).filter((row) => row.productName && Object.values(row.quantities).some((qty) => qty > 0));
}

function normalizeShippingAddress(value: unknown): ShippingAddress | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const address: ShippingAddress = {
    name: text(row.name, 160),
    line1: text(row.line1, 300),
    line2: text(row.line2, 300),
    city: text(row.city, 160),
    state: text(row.state, 80),
    postalCode: text(row.postalCode, 40),
    country: text(row.country, 2).toUpperCase() || "US",
  };
  if (!address.line1 && !address.city && !address.state && !address.postalCode) return null;
  return address;
}

function sanitizeFileName(name: string) {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return cleaned || "artwork-file";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Honeypot for basic bot spam.
    if (text(body.website, 200)) {
      return NextResponse.json({ ok: true, requestNumber: "submitted" });
    }

    const name = text(body.name, 160);
    const email = text(body.email, 320).toLowerCase();
    const product = text(body.product, 300);
    const orderItems = normalizeOrderItems(body.orderItems);
    const structuredQuantity = orderItemsQuantity(orderItems);
    const quantity = structuredQuantity > 0 ? structuredQuantity : Number(body.quantity || 0);
    const shippingAddress = normalizeShippingAddress(body.shippingAddress);
    const fulfillmentMethod = text(body.delivery, 120);
    const destinationFulfillment = fulfillmentMethod === "Shipping" || fulfillmentMethod === "Local delivery";

    const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!name || !emailLooksValid || !product) {
      return NextResponse.json(
        { error: "Please complete your name, email, and product." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return NextResponse.json(
        { error: `Quantity must be a whole number between 1 and ${MAX_QUANTITY.toLocaleString()}.` },
        { status: 400 }
      );
    }

    if (destinationFulfillment && (!shippingAddress?.line1 || !shippingAddress.city || !shippingAddress.state || !shippingAddress.postalCode || !shippingAddress.country)) {
      return NextResponse.json(
        { error: fulfillmentMethod === "Local delivery"
          ? "Please complete the local delivery address before submitting your request."
          : "Please complete the shipping address before submitting your request." },
        { status: 400 }
      );
    }

    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES) : [];
    if (Array.isArray(body.files) && body.files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Please upload no more than ${MAX_FILES} files.` },
        { status: 400 }
      );
    }

    for (const file of files) {
      if (!file || typeof file.name !== "string" || typeof file.size !== "number") {
        return NextResponse.json({ error: "One of the artwork files is invalid." }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `${file.name} is larger than 20 MB.` },
          { status: 400 }
        );
      }
    }

    const artworkRightsAccepted = files.length > 0 && body.artworkRightsAccepted === true;
    const artworkRightsPolicyVersion = artworkRightsAccepted ? text(body.artworkRightsPolicyVersion, 120) : "";
    const placements = Array.isArray(body.placements)
      ? body.placements.map((v: unknown) => text(v, 60)).filter(Boolean).slice(0, 12)
      : [];

    const authClient = await createSupabaseServerClient();
    const { data: authData } = await authClient.auth.getUser();
    const customerUserId = authData.user?.id ?? null;

    const supabase = getSupabaseAdmin();
    const { data: created, error: insertError } = await supabase
      .from("custom_requests")
      .insert({
        customer_name: name,
        email,
        customer_user_id: customerUserId,
        phone: text(body.phone, 80) || null,
        sms_consent: Boolean(text(body.phone, 80)) && body.smsConsent === true,
        sms_consent_at: Boolean(text(body.phone, 80)) && body.smsConsent === true ? new Date().toISOString() : null,
        product,
        quantity,
        item_type: text(body.itemType, 300) || null,
        colors: text(body.colors, 500) || null,
        sizes: text(body.sizes, 3000) || null,
        logo_size: text(body.logoSize, 500) || null,
        print_sides: text(body.printSides, 100) || null,
        placements,
        artwork_instructions: text(body.artworkInstructions, 5000) || null,
        deadline: text(body.deadline, 20) || null,
        delivery: fulfillmentMethod || null,
        notes: text(body.notes, 5000) || null,
        requested_discount_code: text(body.discountCode, 80).toUpperCase() || null,
        order_items: orderItems,
        shipping_address: shippingAddress,
        artwork_rights_accepted: artworkRightsAccepted,
        artwork_rights_accepted_at: artworkRightsAccepted ? new Date().toISOString() : null,
        artwork_rights_policy_version: artworkRightsPolicyVersion || null,
        artwork_rights_snapshot: artworkRightsAccepted ? { accepted: true, policyVersion: artworkRightsPolicyVersion, email } : null,
        artwork_rights_review_status: artworkRightsAccepted ? "customer_attested" : "not_reviewed",
      })
      .select("id, request_number, submission_token")
      .single();

    if (insertError || !created) {
      console.error("Custom request insert failed", insertError);
      return NextResponse.json(
        { error: "We could not save your request. Please try again." },
        { status: 500 }
      );
    }

    const uploadTargets = [] as Array<{
      index: number;
      name: string;
      path: string;
      token: string;
    }>;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const safeName = sanitizeFileName(file.name);
      const path = `${created.id}/${Date.now()}-${index}-${safeName}`;
      const { data, error } = await supabase.storage
        .from(CUSTOM_REQUEST_BUCKET)
        .createSignedUploadUrl(path);

      if (error || !data?.token) {
        console.error("Signed artwork upload URL failed", error);
        continue;
      }

      uploadTargets.push({ index, name: file.name, path, token: data.token });
    }

    const reference = formatRequestNumber(created.request_number);
    const adminEmail = process.env.MOORE_MADE_ADMIN_EMAIL;
    let emailWarning = false;

    const summaryRows = [
      ["Product", product],
      ["Quantity", String(quantity)],
      ["Items", orderItems.length > 1 ? `${orderItems.length} product/color groups` : ""],
      ["Style", text(body.itemType, 300)],
      ["Colors", text(body.colors, 500)],
      ["Needed by", text(body.deadline, 20)],
      ["Fulfillment", fulfillmentMethod],
      ["Discount code", text(body.discountCode, 80).toUpperCase()],
    ].filter(([, value]) => value);

    const summaryHtml = summaryRows
      .map(([label, value]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b6b6b;">${escapeHtml(label)}</td><td style="padding:6px 0;font-weight:700;">${escapeHtml(value)}</td></tr>`)
      .join("");

    const customerEmail = await sendMooreMadeEmail({
      to: email,
      subject: `We received your Moore Made request ${reference}`,
      replyTo: adminEmail,
      html: emailShell(
        "We received your custom request.",
        `<p style="line-height:1.65;margin:0 0 16px;">Hi ${escapeHtml(name)}, thanks for sending your idea to Moore Made. Your request is saved. Please allow 1–2 business days for review. The next normal step is an email with your mockup + quote for one-step approval. If we need clarification first, we&apos;ll contact you.</p>
         <p style="line-height:1.65;margin:0 0 16px;"><strong>Reference:</strong> ${escapeHtml(reference)}</p>
         <table style="border-collapse:collapse;margin:0 0 18px;">${summaryHtml}</table>
         <p style="line-height:1.65;margin:0;">No payment has been taken. No reply is needed right now. Keep this email for your records.</p>`
      ),
    });
    if (!customerEmail.ok) emailWarning = true;
    else await recordCustomerEmailNotification({ requestId: created.id, recipientEmails: email, subject: `We received your Moore Made request ${reference}`, body: "Your custom request is saved. Please allow 1–2 business days for review. The next normal step is your mockup + personalized quote.", topic: "order", label: "Request confirmation email sent" });

    if (adminEmail) {
      const adminResult = await sendMooreMadeEmail({
        to: adminEmail,
        subject: `New Moore Made request ${reference} — ${product}`,
        replyTo: email,
        html: emailShell(
          `New custom request ${reference}`,
          `<p style="line-height:1.65;margin:0 0 16px;"><strong>${escapeHtml(name)}</strong> submitted a new request.</p>
           <table style="border-collapse:collapse;margin:0 0 18px;">${summaryHtml}</table>
           <p style="line-height:1.65;margin:0 0 18px;"><strong>Email:</strong> ${escapeHtml(email)}${text(body.phone,80) ? `<br><strong>Phone:</strong> ${escapeHtml(text(body.phone,80))}` : ""}</p>
           <a href="${siteUrl()}/admin" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:800;">Open admin dashboard</a>`
        ),
      });
      if (!adminResult.ok) emailWarning = true;
    }

    return NextResponse.json({
      ok: true,
      requestId: created.id,
      requestNumber: created.request_number,
      submissionToken: created.submission_token,
      uploads: uploadTargets,
      emailWarning,
    });
  } catch (error) {
    console.error("Custom request route error", error);
    return NextResponse.json(
      { error: "Something went wrong while submitting your request." },
      { status: 500 }
    );
  }
}
