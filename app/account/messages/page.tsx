import { redirect } from "next/navigation";
import { CustomerMessagesWorkspace } from "@/components/messages/CustomerMessagesWorkspace";
import { claimVerifiedGuestRecords, getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { customerSafeStaffName, MESSAGE_BUCKET } from "@/lib/message-server";
import type { CustomerMessageThread, MessageAttachment, MessageEntry, MessageTopic, MessageThreadStatus } from "@/lib/message-types";

export const metadata = { title: "Messages | Moore Made", robots: { index: false, follow: false } };

type ThreadRow = { id:string; request_id:string|null; subject:string; topic:MessageTopic; status:MessageThreadStatus; customer_unread_count:number; last_message_at:string; created_at:string; };
type EntryRow = { id:string; thread_id:string; sender_user_id:string|null; sender_role:"customer"|"admin"|"system"; sender_display_name:string; body:string; is_internal:boolean; created_at:string; };
type AttachmentRow = { id:string; message_id:string; storage_path:string; original_filename:string; mime_type:string|null; size_bytes:number|null; };
type OrderRow = { id:string; request_number:number; product:string; };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ thread?: string; order?: string; new?: string }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/account/login?next=${encodeURIComponent("/account/messages")}`);
  await claimVerifiedGuestRecords(user);
  const supabase = await createSupabaseServerClient();

  const [{ data: threadData }, { data: orderData }] = await Promise.all([
    supabase.from("message_threads").select("id,request_id,subject,topic,status,customer_unread_count,last_message_at,created_at").order("last_message_at", { ascending: false }),
    supabase.from("custom_requests").select("id,request_number,product").order("created_at", { ascending: false }),
  ]);
  const threadRows = (threadData ?? []) as ThreadRow[];
  const orders = (orderData ?? []) as OrderRow[];
  const threadIds = threadRows.map((row) => row.id);
  const { data: entryData } = threadIds.length
    ? await supabase.from("message_entries").select("id,thread_id,sender_user_id,sender_role,sender_display_name,body,is_internal,created_at").in("thread_id", threadIds).order("created_at", { ascending: true })
    : { data: [] as EntryRow[] };
  const entries = (entryData ?? []) as EntryRow[];
  const entryIds = entries.map((row) => row.id);
  const { data: attachmentData } = entryIds.length
    ? await supabase.from("message_attachments").select("id,message_id,storage_path,original_filename,mime_type,size_bytes").in("message_id", entryIds).order("created_at", { ascending: true })
    : { data: [] as AttachmentRow[] };
  const attachments = (attachmentData ?? []) as AttachmentRow[];
  const requestById = new Map(orders.map((order) => [order.id, order]));

  const signedByAttachment = new Map<string, string>();
  for (const attachment of attachments) {
    const { data: signed } = await supabase.storage.from(MESSAGE_BUCKET).createSignedUrl(attachment.storage_path, 900);
    if (signed?.signedUrl) signedByAttachment.set(attachment.id, signed.signedUrl);
  }

  const threads: CustomerMessageThread[] = threadRows.map((thread) => {
    const order = thread.request_id ? requestById.get(thread.request_id) : null;
    const threadEntries: MessageEntry[] = entries.filter((entry) => entry.thread_id === thread.id).map((entry) => ({
      id: entry.id,
      threadId: entry.thread_id,
      senderUserId: entry.sender_user_id,
      senderRole: entry.sender_role,
      senderDisplayName: entry.sender_role === "admin"
        ? customerSafeStaffName(entry.sender_display_name)
        : entry.sender_display_name,
      body: entry.body,
      isInternal: false,
      createdAt: entry.created_at,
      attachments: attachments.filter((file) => file.message_id === entry.id).map((file): MessageAttachment => ({
        id: file.id,
        path: file.storage_path,
        originalName: file.original_filename,
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
        url: signedByAttachment.get(file.id),
      })),
    }));
    return {
      id: thread.id,
      requestId: thread.request_id,
      requestNumber: order?.request_number ?? null,
      requestProduct: order?.product ?? null,
      subject: thread.subject,
      topic: thread.topic,
      status: thread.status,
      customerUnreadCount: thread.customer_unread_count,
      lastMessageAt: thread.last_message_at,
      createdAt: thread.created_at,
      entries: threadEntries,
    };
  });

  return <div className="shell accountMessagesPage">
    <section className="pageHero accountMessagesHero"><div className="eyebrow">My Moore Made</div><h1>Messages.</h1><p className="lead">Keep order questions, design details, payment questions, and general conversations in one place.</p></section>
    <CustomerMessagesWorkspace threads={threads} orders={orders.map((order) => ({ id: order.id, requestNumber: order.request_number, product: order.product }))} initialThreadId={params.thread || null} initialRequestId={params.order || null} />
  </div>;
}
