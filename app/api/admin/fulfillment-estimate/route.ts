import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { emailShell, escapeHtml, publicSiteUrl, sendMooreMadeEmail } from "@/lib/email";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { recordCustomerEmailNotification } from "@/lib/message-server";

function text(value: unknown, max = 1500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const id = text(body.id, 100);
    const estimatedDate = text(body.estimatedDate, 10);
    const estimatedNote = text(body.estimatedNote, 1500);
    const notify = body.notify === true;

    if (!id || !validDate(estimatedDate)) return NextResponse.json({ error: "Choose a valid estimated date." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: row, error } = await supabase
      .from("custom_requests")
      .select("id,request_number,customer_name,email,product,delivery,status,estimated_fulfillment_date,estimated_fulfillment_note,estimated_fulfillment_notified_at,estimated_fulfillment_notified_for_date")
      .eq("id", id)
      .single();

    if (error || !row) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (row.status !== "in_production") return NextResponse.json({ error: "Set the order to In production before adding a production estimate." }, { status: 409 });

    const { error: updateError } = await supabase.from("custom_requests").update({
      estimated_fulfillment_date: estimatedDate,
      estimated_fulfillment_note: estimatedNote || null,
    }).eq("id", id);

    if (updateError) {
      console.error("Estimated fulfillment save failed", updateError);
      return NextResponse.json({ error: "Could not save the estimated date. Make sure the new Supabase migration has been run." }, { status: 500 });
    }

    if (!notify) {
      return NextResponse.json({
        ok: true,
        notifiedAt: row.estimated_fulfillment_notified_at,
        notifiedForDate: row.estimated_fulfillment_notified_for_date,
      });
    }

    const fulfillmentValue = String(row.delivery || "").toLowerCase();
    const isShipping = fulfillmentValue.includes("ship");
    const isLocalDelivery = fulfillmentValue.includes("delivery") && !isShipping;
    const label = isShipping ? "Estimated ship date" : isLocalDelivery ? "Estimated delivery-ready date" : "Estimated pickup-ready date";
    const reference = formatRequestNumber(row.request_number);
    const changed = Boolean(row.estimated_fulfillment_date && row.estimated_fulfillment_date !== estimatedDate);
    const disclaimer = isShipping
      ? "This date is an estimate and is not guaranteed. It represents when Moore Made expects to hand your order to the shipping carrier. It is not a guaranteed delivery date, and carrier transit or delivery timing cannot be guaranteed."
      : isLocalDelivery
        ? "This date is an estimate and is not guaranteed. Moore Made will notify you again when your order is officially ready for local delivery."
        : "This date is an estimate and is not guaranteed. Moore Made will notify you again when your order is officially ready for pickup.";
    const noteHtml = estimatedNote ? `<p style="line-height:1.65;margin:0 0 18px;"><strong>Note from Moore Made:</strong><br>${escapeHtml(estimatedNote).replaceAll("\n", "<br>")}</p>` : "";
    const accountUrl = `${publicSiteUrl()}/account`;

    const emailResult = await sendMooreMadeEmail({
      to: row.email,
      subject: `${changed ? `${label} updated` : label} — ${reference}`,
      replyTo: process.env.MOORE_MADE_ADMIN_EMAIL,
      html: emailShell(
        changed ? "Your production estimate was updated." : "Your order is in production.",
        `<p style="line-height:1.65;margin:0 0 16px;">Hi ${escapeHtml(row.customer_name)}, your <strong>${escapeHtml(row.product)}</strong> order <strong>${escapeHtml(reference)}</strong> is in production.</p>
         <div style="background:#f7f5f0;border:1px solid #ded9d1;border-radius:12px;padding:16px;margin:0 0 18px;">
           <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#6b6b6b;">${escapeHtml(label)}</div>
           <div style="font-size:24px;font-weight:900;margin-top:5px;">${escapeHtml(displayDate(estimatedDate))}</div>
         </div>
         ${noteHtml}
         <p style="line-height:1.6;margin:0 0 18px;color:#6b6b6b;font-size:13px;">${escapeHtml(disclaimer)}</p>
         <a href="${escapeHtml(accountUrl)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;font-weight:800;padding:11px 16px;border-radius:10px;">View your order →</a>`
      ),
    });

    if (!emailResult.ok) {
      return NextResponse.json({ error: "The estimate was saved, but the customer email could not be sent. Check Resend and try Save & notify customer again.", saved: true }, { status: 502 });
    }

    const now = new Date().toISOString();
    const { error: notifiedError } = await supabase.from("custom_requests").update({
      estimated_fulfillment_notified_at: now,
      estimated_fulfillment_notified_for_date: estimatedDate,
    }).eq("id", id);
    if (notifiedError) console.error("Estimate email sent but notification timestamp save failed", notifiedError);
    await recordCustomerEmailNotification({ requestId: id, recipientEmails: row.email, subject: `${changed ? `${label} updated` : label} — ${reference}`, body: `${label}: ${displayDate(estimatedDate)}.${estimatedNote ? ` Note: ${estimatedNote}` : ""}`, topic: "shipping", label: "Production estimate email sent" });

    return NextResponse.json({ ok: true, notifiedAt: now, notifiedForDate: estimatedDate });
  } catch (error) {
    console.error("Estimated fulfillment notification failed", error);
    return NextResponse.json({ error: "Could not save the production estimate." }, { status: 500 });
  }
}
