import { NextResponse } from "next/server";
import { emailShell, escapeHtml, sendMooreMadeEmail, siteUrl } from "@/lib/email";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { money } from "@/lib/quote-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type RouteProps = { params: Promise<{ token: string }> };

function text(value: unknown, max = 3000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

type ItemChangeInput = { proofItemId: string; message: string };

function normalizeItemChanges(value: unknown): ItemChangeInput[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).map((item) => ({
    proofItemId: text(item?.proofItemId, 100),
    message: text(item?.message, 3000),
  })).filter((item) => item.proofItemId && item.message.length >= 3);
}

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const { token } = await params;
    const body = await request.json();
    const response = body.response === "approve" ? "approved" : body.response === "changes" ? "changes_requested" : "";
    const generalChangeRequest = text(body.generalChangeRequest ?? body.changeRequest, 3000);
    const itemChanges = normalizeItemChanges(body.itemChanges);

    if (!token || !response) {
      return NextResponse.json({ error: "Invalid response." }, { status: 400 });
    }
    if (response === "approved" && body.confirmed !== true) {
      return NextResponse.json({ error: "Please confirm that you reviewed every proof and the order details." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: quote, error } = await supabase
      .from("quotes")
      .select("id,request_id,status,total_cents,valid_until,proof_paths,proof_version,custom_requests(request_number,customer_name,email,product)")
      .eq("public_token", token)
      .single();

    if (error || !quote) return NextResponse.json({ error: "Proof + quote not found." }, { status: 404 });
    if (quote.status !== "sent") {
      return NextResponse.json({ error: "This proof + quote has already been responded to or is no longer active." }, { status: 409 });
    }

    if (quote.valid_until) {
      const end = new Date(`${quote.valid_until}T23:59:59`);
      if (Date.now() > end.getTime()) {
        await supabase.from("quotes").update({ status: "expired" }).eq("id", quote.id);
        return NextResponse.json({ error: "This approval has expired. Please contact Moore Made for an updated proof + quote." }, { status: 410 });
      }
    }

    const { data: proofItemsData } = await supabase
      .from("quote_proof_items")
      .select("id,title,quote_proof_assets(id)")
      .eq("quote_id", quote.id)
      .eq("proof_version", Math.max(1, Number(quote.proof_version || 1)));

    type ProofRow = { id:string; title:string; quote_proof_assets:Array<{id:string}>|null };
    const proofRows = (proofItemsData ?? []) as unknown as ProofRow[];
    const legacyProofCount = Array.isArray(quote.proof_paths) ? quote.proof_paths.length : 0;
    const hasCompleteProofSet = proofRows.length
      ? proofRows.every((item) => (item.quote_proof_assets ?? []).length > 0)
      : legacyProofCount > 0;

    if (response === "approved" && !hasCompleteProofSet) {
      return NextResponse.json({ error: "The proof is unavailable. Please contact Moore Made before approving." }, { status: 409 });
    }

    const titleById = new Map(proofRows.map((item) => [item.id, item.title]));
    const validItemChanges = itemChanges
      .filter((change) => titleById.has(change.proofItemId))
      .map((change) => ({ ...change, proofItemTitle: titleById.get(change.proofItemId) as string }));

    if (response === "changes_requested" && generalChangeRequest.length < 3 && validItemChanges.length === 0) {
      return NextResponse.json({ error: "Tell us what you would like changed. You can leave a general note or identify a specific product." }, { status: 400 });
    }

    const requestRow = Array.isArray(quote.custom_requests) ? quote.custom_requests[0] : quote.custom_requests;
    if (!requestRow) return NextResponse.json({ error: "Request details are unavailable." }, { status: 500 });

    let changeRequestId: string | null = null;
    if (response === "changes_requested") {
      const { data: changeRequest, error: changeError } = await supabase
        .from("quote_change_requests")
        .insert({
          quote_id: quote.id,
          proof_version: Math.max(1, Number(quote.proof_version || 1)),
          general_message: generalChangeRequest || null,
        })
        .select("id")
        .single();
      if (changeError || !changeRequest) {
        console.error("Change request save failed", changeError);
        return NextResponse.json({ error: "Could not save your requested changes." }, { status: 500 });
      }
      changeRequestId = changeRequest.id;

      if (validItemChanges.length) {
        const { error: itemChangeError } = await supabase.from("quote_change_request_items").insert(validItemChanges.map((change) => ({
          change_request_id: changeRequest.id,
          proof_item_id: change.proofItemId,
          proof_item_title: change.proofItemTitle,
          message: change.message,
        })));
        if (itemChangeError) {
          console.error("Item change request save failed", itemChangeError);
          return NextResponse.json({ error: "Could not save the product-specific changes." }, { status: 500 });
        }
      }
    }

    const aggregateChangeText = response === "changes_requested"
      ? [generalChangeRequest, ...validItemChanges.map((change) => `${change.proofItemTitle}: ${change.message}`)].filter(Boolean).join("\n\n")
      : null;

    const respondedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("quotes")
      .update({
        status: response,
        responded_at: respondedAt,
        customer_change_request: aggregateChangeText,
      })
      .eq("id", quote.id);

    if (updateError) return NextResponse.json({ error: "Could not record your response." }, { status: 500 });

    await supabase
      .from("custom_requests")
      .update({ status: response === "approved" ? "approved" : "reviewing" })
      .eq("id", quote.request_id);

    const adminEmail = process.env.MOORE_MADE_ADMIN_EMAIL;
    if (adminEmail) {
      const reference = formatRequestNumber(requestRow.request_number);
      const itemChangeHtml = validItemChanges.length
        ? `<div style="margin:12px 0 0;">${validItemChanges.map((change) => `<div style="border-top:1px solid #ded9d1;padding:10px 0 0;margin:10px 0 0;"><strong>${escapeHtml(change.proofItemTitle)}</strong><p style="line-height:1.6;margin:5px 0 0;">${escapeHtml(change.message)}</p></div>`).join("")}</div>`
        : "";
      const changeHtml = response === "changes_requested"
        ? `<div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:14px 16px;margin:0 0 18px;"><strong>Requested changes</strong>${generalChangeRequest ? `<p style="line-height:1.65;margin:8px 0 0;">${escapeHtml(generalChangeRequest)}</p>` : ""}${itemChangeHtml}</div>`
        : "";
      await sendMooreMadeEmail({
        to: adminEmail,
        subject: `${response === "approved" ? "Proof + quote approved" : "Changes requested"} — ${reference}`,
        replyTo: requestRow.email,
        html: emailShell(
          response === "approved" ? "A customer approved the complete proof + quote." : "A customer requested proof changes.",
          `<p style="line-height:1.65;margin:0 0 16px;"><strong>${escapeHtml(requestRow.customer_name)}</strong> ${response === "approved" ? "approved the entire proof set and quote for" : "requested changes to"} <strong>${escapeHtml(reference)}</strong>.</p>
           <p style="line-height:1.5;margin:0 0 16px;color:#6b6b6b;">Proof version ${Number(quote.proof_version || 1)}${changeRequestId ? ` · Change request saved` : ""}</p>
           ${changeHtml}
           <p style="font-size:22px;margin:0 0 20px;"><strong>${escapeHtml(money(quote.total_cents))}</strong></p>
           <a href="${siteUrl()}/admin" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:800;">Open admin dashboard</a>`
        ),
      });
    }

    return NextResponse.json({ ok: true, status: response });
  } catch (error) {
    console.error("Proof + quote response failed", error);
    return NextResponse.json({ error: "Could not record your response." }, { status: 500 });
  }
}
