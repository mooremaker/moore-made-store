import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { cleanMessageText, getDisplayName, notifyAdminsOfCustomerMessage, uploadMessageAttachments, validateMessageFiles } from "@/lib/message-server";
import type { MessageTopic } from "@/lib/message-types";

const allowedTopics = new Set<MessageTopic>(["order","product","artwork","payment","shipping","other"]);
type OrderContext = { id: string; request_number: number; product: string; customer_name: string; email: string };
type ThreadContext = { id: string; subject: string; admin_unread_count: number };

export async function POST(request: Request) {
  try {
    const authClient = await createSupabaseServerClient();
    const { data: authData } = await authClient.auth.getUser();
    const user = authData.user;
    if (!user?.email) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

    const form = await request.formData();
    const requestId = cleanMessageText(form.get("requestId"), 80) || null;
    const topicValue = cleanMessageText(form.get("topic"), 40) as MessageTopic;
    const topic: MessageTopic = allowedTopics.has(topicValue) ? topicValue : requestId ? "order" : "other";
    const body = cleanMessageText(form.get("body"), 6000);
    const rawSubject = cleanMessageText(form.get("subject"), 180);
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    const fileError = validateMessageFiles(files);
    if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });
    if (!body && !files.length) return NextResponse.json({ error: "Write a message or attach a file." }, { status: 400 });

    const admin = getSupabaseAdmin();
    let order: OrderContext | null = null;
    if (requestId) {
      const { data } = await authClient.from("custom_requests").select("id,request_number,product,customer_name,email").eq("id", requestId).maybeSingle();
      if (!data) return NextResponse.json({ error: "That order is not available to this account." }, { status: 403 });
      order = data as OrderContext;
    }

    let thread: ThreadContext | null = null;
    if (requestId) {
      const { data } = await admin.from("message_threads").select("id,subject,admin_unread_count").eq("request_id", requestId).eq("customer_user_id", user.id).maybeSingle();
      thread = data as ThreadContext | null;
    }

    const customerName = await getDisplayName(user.id, order?.customer_name || user.email.split("@")[0]);
    const subject = order
      ? `${formatRequestNumber(order.request_number)} · ${order.product}`.slice(0, 180)
      : (rawSubject || "General question").slice(0, 180);

    if (!thread) {
      const { data, error } = await admin.from("message_threads").insert({
        customer_user_id: user.id,
        request_id: requestId,
        subject,
        topic: order ? "order" : topic,
        status: "open",
        admin_unread_count: 1,
        customer_unread_count: 0,
        last_message_at: new Date().toISOString(),
      }).select("id,subject,admin_unread_count").single();
      if (error || !data) {
        console.error("Create message thread failed", error);
        return NextResponse.json({ error: "We could not start this conversation." }, { status: 500 });
      }
      thread = data as ThreadContext;
    } else {
      await admin.from("message_threads").update({
        status: "open",
        admin_unread_count: Number(thread.admin_unread_count || 0) + 1,
        customer_unread_count: 0,
        last_message_at: new Date().toISOString(),
      }).eq("id", thread.id);
    }

    if (!thread) return NextResponse.json({ error: "We could not start this conversation." }, { status: 500 });

    const { data: entry, error: entryError } = await admin.from("message_entries").insert({
      thread_id: thread.id,
      sender_user_id: user.id,
      sender_role: "customer",
      sender_display_name: customerName,
      body: body || "Attachment sent.",
      is_internal: false,
    }).select("id").single();
    if (entryError || !entry) {
      console.error("Initial message insert failed", entryError);
      return NextResponse.json({ error: "We could not send your message." }, { status: 500 });
    }

    if (files.length) await uploadMessageAttachments(admin, thread.id, entry.id, files);


    await notifyAdminsOfCustomerMessage({
      customerName,
      customerEmail: user.email,
      subject: thread.subject,
      body: body || "Attachment sent.",
      orderReference: order ? formatRequestNumber(order.request_number) : null,
    });

    return NextResponse.json({ ok: true, threadId: thread.id });
  } catch (error) {
    console.error("Start message thread error", error);
    return NextResponse.json({ error: "Something went wrong while sending your message." }, { status: 500 });
  }
}
