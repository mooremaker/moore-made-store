import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { cleanMessageText, getDisplayName, notifyAdminsOfCustomerMessage, uploadMessageAttachments, validateMessageFiles } from "@/lib/message-server";
import { formatRequestNumber } from "@/lib/custom-request-types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const authClient = await createSupabaseServerClient();
    const { data: authData } = await authClient.auth.getUser();
    const user = authData.user;
    if (!user?.email) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

    const { data: owned } = await authClient.from("message_threads").select("id,subject,request_id").eq("id", id).maybeSingle();
    if (!owned) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

    const form = await request.formData();
    const body = cleanMessageText(form.get("body"), 6000);
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    const fileError = validateMessageFiles(files);
    if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });
    if (!body && !files.length) return NextResponse.json({ error: "Write a message or attach a file." }, { status: 400 });

    const admin = getSupabaseAdmin();
    const customerName = await getDisplayName(user.id, user.email.split("@")[0]);
    const { data: entry, error } = await admin.from("message_entries").insert({
      thread_id: id,
      sender_user_id: user.id,
      sender_role: "customer",
      sender_display_name: customerName,
      body: body || "Attachment sent.",
      is_internal: false,
    }).select("id").single();
    if (error || !entry) return NextResponse.json({ error: "We could not send your message." }, { status: 500 });

    if (files.length) await uploadMessageAttachments(admin, id, entry.id, files);

    const { data: threadRow } = await admin.from("message_threads").select("admin_unread_count,request_id,subject").eq("id", id).single();
    await admin.from("message_threads").update({
      status: "open",
      admin_unread_count: Number(threadRow?.admin_unread_count || 0) + 1,
      customer_unread_count: 0,
      last_message_at: new Date().toISOString(),
    }).eq("id", id);

    let orderReference: string | null = null;
    if (threadRow?.request_id) {
      const { data: order } = await admin.from("custom_requests").select("request_number").eq("id", threadRow.request_id).maybeSingle();
      if (order) orderReference = formatRequestNumber(order.request_number);
    }

    await notifyAdminsOfCustomerMessage({
      customerName,
      customerEmail: user.email,
      subject: threadRow?.subject || owned.subject,
      body: body || "Attachment sent.",
      orderReference,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Customer message reply error", error);
    return NextResponse.json({ error: "Something went wrong while sending your reply." }, { status: 500 });
  }
}
