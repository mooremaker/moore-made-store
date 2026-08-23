import { NextResponse } from "next/server";
import { emailShell, escapeHtml, sendMooreMadeEmail } from "@/lib/email";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function clean(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const body = await request.json().catch(() => ({}));
  if (clean(body.website, 200)) return NextResponse.json({ ok: true });

  const name = clean(body.name, 160);
  const email = clean(body.email, 320).toLowerCase();
  const phone = clean(body.phone, 80);
  const preferredContact = ["phone", "email", "either"].includes(body.preferredContact) ? body.preferredContact : "either";
  const amountRange = clean(body.amountRange, 80) || null;
  const message = clean(body.message, 1500) || null;
  const helpRequested = body.helpRequested !== false;
  const acknowledged = body.giftTermsAcknowledged === true;

  if (!name) return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  if (!email && !phone) return NextResponse.json({ error: "Please enter a phone number or email." }, { status: 400 });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  if (!acknowledged) return NextResponse.json({ error: "Please confirm that you understand this is a voluntary gift." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: settings } = await supabase.from("support_page_settings").select("id,enabled,expires_at").eq("access_token", token).maybeSingle();
  if (!settings?.enabled || (settings.expires_at && new Date(settings.expires_at) <= new Date())) return NextResponse.json({ error: "This private support link is no longer active." }, { status: 410 });

  const { data: inquiry, error } = await supabase.from("support_inquiries").insert({
    settings_id: settings.id,
    name,
    email: email || null,
    phone: phone || null,
    preferred_contact: preferredContact,
    amount_range: amountRange,
    message,
    help_requested: helpRequested,
    gift_terms_acknowledged: true,
  }).select("id").single();
  if (error || !inquiry) return NextResponse.json({ error: "We could not save this message. Please call MooreMade instead." }, { status: 500 });

  const adminEmail = process.env.MOORE_MADE_ADMIN_EMAIL;
  if (adminEmail) {
    const sent = await sendMooreMadeEmail({
      to: adminEmail,
      replyTo: email || undefined,
      subject: `New Moore Made support interest — ${name}`,
      html: emailShell("Someone wants to support Moore Made", `<p style="line-height:1.65;margin:0 0 14px;"><strong>${escapeHtml(name)}</strong> asked Moore Made to follow up about making a voluntary gift.</p><p style="line-height:1.65;margin:0 0 14px;"><strong>Phone:</strong> ${escapeHtml(phone || "Not provided")}<br><strong>Email:</strong> ${escapeHtml(email || "Not provided")}<br><strong>Preferred contact:</strong> ${escapeHtml(preferredContact)}<br><strong>Possible amount:</strong> ${escapeHtml(amountRange || "Not specified")}</p>${message ? `<p style="line-height:1.65;margin:0;"><strong>Message:</strong><br>${escapeHtml(message)}</p>` : ""}`),
    });
    await supabase.from("support_inquiries").update(sent.ok ? { admin_email_sent_at: new Date().toISOString(), admin_email_error: null } : { admin_email_error: sent.error }).eq("id", inquiry.id);
  }

  return NextResponse.json({ ok: true });
}
