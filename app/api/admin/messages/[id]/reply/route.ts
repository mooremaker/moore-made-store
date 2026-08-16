import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { cleanMessageText, customerSafeStaffName, getDisplayName, notifyCustomerOfAdminReply, uploadMessageAttachments, validateMessageFiles } from "@/lib/message-server";
import { formatRequestNumber } from "@/lib/custom-request-types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminApi();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { id } = await params;
    const form = await request.formData();
    const body = cleanMessageText(form.get("body"), 6000);
    const internal = form.get("internal") === "true";
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    const fileError = validateMessageFiles(files);
    if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });
    if (!body && !files.length) return NextResponse.json({ error: "Write a reply or attach a file." }, { status: 400 });

    const admin = getSupabaseAdmin();
    const { data: thread } = await admin.from("message_threads").select("id,customer_user_id,request_id,subject,customer_unread_count").eq("id", id).maybeSingle();
    if (!thread) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

    const staffFullName = await getDisplayName(auth.user.id, auth.user.email?.split("@")[0] || "Moore Made");
    const staffName = customerSafeStaffName(staffFullName);
    const { data: entry, error } = await admin.from("message_entries").insert({
      thread_id: id,
      sender_user_id: auth.user.id,
      sender_role: "admin",
      sender_display_name: staffName,
      body: body || "Attachment sent.",
      is_internal: internal,
    }).select("id").single();
    if (error || !entry) return NextResponse.json({ error: "We could not save this reply." }, { status: 500 });
    if (files.length) await uploadMessageAttachments(admin, id, entry.id, files);

    await admin.from("message_threads").update({
      admin_unread_count: 0,
      customer_unread_count: internal ? Number(thread.customer_unread_count || 0) : Number(thread.customer_unread_count || 0) + 1,
      last_message_at: new Date().toISOString(),
    }).eq("id", id);

    if (!internal) {
      const { data: userResult } = await admin.auth.admin.getUserById(thread.customer_user_id);
      const customerEmail = userResult.user?.email;
      const { data: profile } = await admin.from("profiles").select("full_name").eq("id", thread.customer_user_id).maybeSingle();
      let orderReference: string | null = null;
      if (thread.request_id) {
        const { data: order } = await admin.from("custom_requests").select("request_number,customer_name,email").eq("id", thread.request_id).maybeSingle();
        if (order) orderReference = formatRequestNumber(order.request_number);
      }
      if (customerEmail) {
        await notifyCustomerOfAdminReply({
          customerEmail,
          customerName: profile?.full_name?.trim() || customerEmail.split("@")[0],
          staffName,
          subject: thread.subject,
          body: body || "Attachment sent.",
          threadId: id,
          orderReference,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Admin message reply error", error);
    return NextResponse.json({ error: "Something went wrong while saving the reply." }, { status: 500 });
  }
}
