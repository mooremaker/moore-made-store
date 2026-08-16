import { redirect } from "next/navigation";
import { getAdminAuthState } from "@/lib/auth";
import type { RequestStatus } from "@/lib/custom-request-types";
import type { ShowcaseStatus } from "@/lib/showcase-types";
import { CUSTOM_REQUEST_BUCKET, QUOTE_PROOF_BUCKET, getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";
import type { QuoteRecord } from "@/lib/quote-types";
import { AdminWorkspace, type AdminRequestRow, type AdminShowcaseRow } from "@/components/AdminWorkspace";
import { MESSAGE_BUCKET } from "@/lib/message-server";
import type { AdminMessageThread, AdminUserOption, MessageAttachment, MessageEntry, MessageTopic, MessageThreadStatus } from "@/lib/message-types";
import { EXPENSE_RECEIPT_BUCKET, type BusinessExpenseReceipt, type BusinessExpenseRow, type FinancialPaymentRow } from "@/lib/finance-types";

export const metadata = { robots: { index: false, follow: false } };

type RequestRow = { id:string; request_number:number; customer_name:string; email:string; phone:string|null; sms_consent:boolean; product:string; quantity:number; item_type:string|null; colors:string|null; sizes:string|null; logo_size:string|null; print_sides:string|null; placements:string[]|null; artwork_instructions:string|null; deadline:string|null; delivery:string|null; notes:string|null; status:RequestStatus; payment_status:"unpaid"|"deposit_paid"|"paid"; amount_paid_cents:number; artwork_paths:string[]|null; tracking_number:string|null; tracking_url:string|null; fulfillment_note:string|null; fulfillment_notified_at:string|null; cash_payment_request_status:"none"|"pending"|"contacted"|"completed"|"cancelled"; cash_payment_requested_at:string|null; cash_payment_requested_amount_cents:number|null; cash_payment_contacted_at:string|null; created_at:string; };
type ShowcaseRow = { id:string; customer_name:string; business_name:string|null; email:string; product:string; rating:number; review:string; caption:string|null; social_handle:string|null; status:ShowcaseStatus; photo_paths:string[]|null; created_at:string; };
type MessageThreadRow = { id:string; customer_user_id:string; request_id:string|null; subject:string; topic:MessageTopic; status:MessageThreadStatus; assigned_admin_user_id:string|null; customer_unread_count:number; admin_unread_count:number; last_message_at:string; created_at:string; };
type MessageEntryRow = { id:string; thread_id:string; sender_user_id:string|null; sender_role:"customer"|"admin"|"system"; sender_display_name:string; body:string; is_internal:boolean; created_at:string; };
type MessageAttachmentRow = { id:string; message_id:string; storage_path:string; original_filename:string; mime_type:string|null; size_bytes:number|null; };

export default async function AdminPage() {
  const auth = await getAdminAuthState();
  if (!auth.user) redirect("/admin/login");
  if (!auth.isAdmin) redirect("/account?admin=denied");
  if (!auth.hasMfa || !auth.aal2) redirect("/admin/mfa");

  if (!isSupabaseConfigured()) return <div className="shell"><section className="pageHero"><div className="eyebrow">Phase 2 setup</div><h1>Connect Supabase.</h1><p className="lead">The admin is unlocked, but the database environment variables are not set yet.</p></section></div>;

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("custom_requests")
    .select("id,request_number,customer_name,email,phone,sms_consent,product,quantity,item_type,colors,sizes,logo_size,print_sides,placements,artwork_instructions,deadline,delivery,notes,status,payment_status,amount_paid_cents,artwork_paths,tracking_number,tracking_url,fulfillment_note,fulfillment_notified_at,cash_payment_request_status,cash_payment_requested_at,cash_payment_requested_amount_cents,cash_payment_contacted_at,created_at")
    .order("created_at", { ascending: false });
  const requests = (data ?? []) as RequestRow[];
  const rowsWithFiles: AdminRequestRow[] = await Promise.all(requests.map(async (row) => ({
    ...row,
    fileLinks: (await Promise.all((row.artwork_paths ?? []).map(async (path) => {
      const { data: signed } = await supabase.storage.from(CUSTOM_REQUEST_BUCKET).createSignedUrl(path, 3600);
      return signed?.signedUrl ? { path, url: signed.signedUrl } : null;
    }))).filter(Boolean) as { path: string; url: string }[],
  })));

  const { data: quoteData, error: quoteError } = await supabase
    .from("quotes")
    .select("id,request_id,public_token,status,line_items,setup_fee_cents,shipping_cents,tax_cents,discount_cents,subtotal_cents,total_cents,payment_terms,deposit_amount_cents,notes,valid_until,proof_paths,proof_notes,proof_version,customer_change_request,sent_at,responded_at,created_at,updated_at");
  const baseQuotes = (quoteData ?? []) as QuoteRecord[];

  const { data: proofItemData, error: proofItemError } = await supabase
    .from("quote_proof_items")
    .select("id,quote_id,proof_version,title,notes,sort_order,quote_proof_assets(id,storage_path,original_filename,sort_order)")
    .order("sort_order", { ascending: true });

  type ProofAssetRow = { id:string; storage_path:string; original_filename:string|null; sort_order:number; };
  type ProofItemRow = { id:string; quote_id:string; proof_version:number; title:string; notes:string|null; sort_order:number; quote_proof_assets:ProofAssetRow[]|null; };
  const proofRows = (proofItemData ?? []) as unknown as ProofItemRow[];

  const { data: changeData } = await supabase
    .from("quote_change_requests")
    .select("id,quote_id,proof_version,general_message,created_at,quote_change_request_items(proof_item_id,proof_item_title,message)")
    .order("created_at", { ascending: false });
  type ChangeItemRow = { proof_item_id:string|null; proof_item_title:string; message:string; };
  type ChangeRow = { id:string; quote_id:string; proof_version:number; general_message:string|null; created_at:string; quote_change_request_items:ChangeItemRow[]|null; };
  const changeRows = (changeData ?? []) as unknown as ChangeRow[];

  const quotes: QuoteRecord[] = await Promise.all(baseQuotes.map(async (quote) => {
    const versions = proofRows.filter((row) => row.quote_id === quote.id).map((row) => Number(row.proof_version || 1));
    const latestStoredVersion = versions.length ? Math.max(...versions) : Number(quote.proof_version || 1);
    const adminVersion = latestStoredVersion;
    const selectedItems = proofRows
      .filter((row) => row.quote_id === quote.id && Number(row.proof_version) === adminVersion)
      .sort((a, b) => a.sort_order - b.sort_order);

    const proofItems = await Promise.all(selectedItems.map(async (item) => ({
      id: item.id,
      quoteId: item.quote_id,
      proofVersion: item.proof_version,
      title: item.title,
      notes: item.notes,
      sortOrder: item.sort_order,
      assets: await Promise.all((item.quote_proof_assets ?? []).sort((a,b) => a.sort_order - b.sort_order).map(async (asset) => {
        const { data: signed } = await supabase.storage.from(QUOTE_PROOF_BUCKET).createSignedUrl(asset.storage_path, 3600);
        return { id: asset.id, path: asset.storage_path, originalName: asset.original_filename, sortOrder: asset.sort_order, url: signed?.signedUrl };
      })),
    })));

    const changeRequests = changeRows.filter((row) => row.quote_id === quote.id).map((row) => ({
      id: row.id,
      proofVersion: row.proof_version,
      generalMessage: row.general_message,
      createdAt: row.created_at,
      items: (row.quote_change_request_items ?? []).map((item) => ({
        proofItemId: item.proof_item_id,
        proofItemTitle: item.proof_item_title,
        message: item.message,
      })),
    }));

    return { ...quote, proofItems, proofItemsVersion: adminVersion, changeRequests };
  }));

  const { data: showcaseData, error: showcaseError } = await supabase
    .from("showcase_posts")
    .select("id,customer_name,business_name,email,product,rating,review,caption,social_handle,status,photo_paths,created_at")
    .order("created_at", { ascending: false });
  const showcaseRows = (showcaseData ?? []) as ShowcaseRow[];
  const showcaseWithPhotos: AdminShowcaseRow[] = await Promise.all(showcaseRows.map(async (row) => ({
    ...row,
    photoLinks: (await Promise.all((row.photo_paths ?? []).map(async (path) => {
      const { data: signed } = await supabase.storage.from("showcase-files").createSignedUrl(path, 3600);
      return signed?.signedUrl ? { path, url: signed.signedUrl } : null;
    }))).filter(Boolean) as { path: string; url: string }[],
  })));

  const { data: messageThreadData, error: messageError } = await supabase
    .from("message_threads")
    .select("id,customer_user_id,request_id,subject,topic,status,assigned_admin_user_id,customer_unread_count,admin_unread_count,last_message_at,created_at")
    .order("last_message_at", { ascending: false });
  const messageThreadRows = (messageThreadData ?? []) as MessageThreadRow[];
  const messageThreadIds = messageThreadRows.map((row) => row.id);

  const { data: messageEntryData, error: messageEntryError } = messageThreadIds.length
    ? await supabase.from("message_entries").select("id,thread_id,sender_user_id,sender_role,sender_display_name,body,is_internal,created_at").in("thread_id", messageThreadIds).order("created_at", { ascending: true })
    : { data: [] as MessageEntryRow[], error: null };
  const messageEntries = (messageEntryData ?? []) as MessageEntryRow[];
  const messageEntryIds = messageEntries.map((row) => row.id);
  const { data: messageAttachmentData, error: messageAttachmentError } = messageEntryIds.length
    ? await supabase.from("message_attachments").select("id,message_id,storage_path,original_filename,mime_type,size_bytes").in("message_id", messageEntryIds).order("created_at", { ascending: true })
    : { data: [] as MessageAttachmentRow[], error: null };
  const messageAttachments = (messageAttachmentData ?? []) as MessageAttachmentRow[];

  const customerIds = [...new Set(messageThreadRows.map((row) => row.customer_user_id))];
  const { data: customerProfiles } = customerIds.length
    ? await supabase.from("profiles").select("id,full_name,phone").in("id", customerIds)
    : { data: [] as { id:string; full_name:string|null; phone:string|null }[] };
  const profileByUser = new Map(((customerProfiles ?? []) as { id:string; full_name:string|null; phone:string|null }[]).map((profile) => [profile.id, profile]));

  const { data: authUsersData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const authUserById = new Map((authUsersData?.users ?? []).map((user) => [user.id, user]));
  const { data: adminRoleData } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
  const adminIds = ((adminRoleData ?? []) as { user_id:string }[]).map((row) => row.user_id);
  const { data: adminProfileData } = adminIds.length
    ? await supabase.from("profiles").select("id,full_name").in("id", adminIds)
    : { data: [] as { id:string; full_name:string|null }[] };
  const adminProfileById = new Map(((adminProfileData ?? []) as { id:string; full_name:string|null }[]).map((profile) => [profile.id, profile.full_name]));
  const adminUsers: AdminUserOption[] = adminIds.map((id) => {
    const authUser = authUserById.get(id);
    const email = authUser?.email || "Admin";
    return { id, email, name: adminProfileById.get(id)?.trim() || email.split("@")[0] || "Admin" };
  });

  const requestById = new Map(requests.map((row) => [row.id, row]));
  const signedMessageAttachmentById = new Map<string, string>();
  for (const attachment of messageAttachments) {
    const { data: signed } = await supabase.storage.from(MESSAGE_BUCKET).createSignedUrl(attachment.storage_path, 3600);
    if (signed?.signedUrl) signedMessageAttachmentById.set(attachment.id, signed.signedUrl);
  }

  const { data: paymentData, error: paymentError } = await supabase
    .from("payments")
    .select("id,request_id,quote_id,payment_kind,amount_cents,currency,status,payment_method,manual_reference,paid_at,created_at,receipt_number,receipt_token")
    .order("created_at", { ascending: false });
  const payments = (paymentData ?? []) as FinancialPaymentRow[];

  const { data: expenseData, error: expenseError } = await supabase
    .from("business_expenses")
    .select("id,expense_date,vendor,category,description,amount_cents,payment_method,note,recorded_by,created_at,updated_at")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });
  const baseExpenses = (expenseData ?? []) as BusinessExpenseRow[];

  const { data: expenseReceiptData, error: expenseReceiptError } = await supabase
    .from("business_expense_receipts")
    .select("id,expense_id,storage_path,original_filename,mime_type,size_bytes,created_at")
    .order("created_at", { ascending: true });
  const expenseReceipts = (expenseReceiptData ?? []) as BusinessExpenseReceipt[];
  const signedExpenseReceiptById = new Map<string, string>();
  for (const receipt of expenseReceipts) {
    const { data: signed } = await supabase.storage.from(EXPENSE_RECEIPT_BUCKET).createSignedUrl(receipt.storage_path, 3600);
    if (signed?.signedUrl) signedExpenseReceiptById.set(receipt.id, signed.signedUrl);
  }
  const expenses: BusinessExpenseRow[] = baseExpenses.map((expense) => ({
    ...expense,
    receipts: expenseReceipts
      .filter((receipt) => receipt.expense_id === expense.id)
      .map((receipt) => ({ ...receipt, url: signedExpenseReceiptById.get(receipt.id) || null })),
  }));

  const messageThreads: AdminMessageThread[] = messageThreadRows.map((thread) => {
    const order = thread.request_id ? requestById.get(thread.request_id) : null;
    const profile = profileByUser.get(thread.customer_user_id);
    const authUser = authUserById.get(thread.customer_user_id);
    const customerEmail = order?.email || authUser?.email || "";
    const entries: MessageEntry[] = messageEntries.filter((entry) => entry.thread_id === thread.id).map((entry) => ({
      id: entry.id,
      threadId: entry.thread_id,
      senderUserId: entry.sender_user_id,
      senderRole: entry.sender_role,
      senderDisplayName: entry.sender_display_name,
      body: entry.body,
      isInternal: entry.is_internal,
      createdAt: entry.created_at,
      attachments: messageAttachments.filter((file) => file.message_id === entry.id).map((file): MessageAttachment => ({
        id: file.id,
        path: file.storage_path,
        originalName: file.original_filename,
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
        url: signedMessageAttachmentById.get(file.id),
      })),
    }));
    return {
      id: thread.id,
      customerUserId: thread.customer_user_id,
      requestId: thread.request_id,
      requestNumber: order?.request_number ?? null,
      requestProduct: order?.product ?? null,
      subject: thread.subject,
      topic: thread.topic,
      status: thread.status,
      customerUnreadCount: thread.customer_unread_count,
      adminUnreadCount: thread.admin_unread_count,
      assignedAdminUserId: thread.assigned_admin_user_id,
      lastMessageAt: thread.last_message_at,
      createdAt: thread.created_at,
      customerName: order?.customer_name || profile?.full_name?.trim() || customerEmail.split("@")[0] || "Customer",
      customerEmail,
      customerPhone: order?.phone || profile?.phone || null,
      smsConsent: Boolean(order?.sms_consent),
      entries,
    };
  });

  return <div className="shell adminPage adminPageRedesign">
    <section className="adminTopbar adminTopbarRedesign">
      <div><div className="eyebrow">Moore Made private admin</div><h1>Order dashboard.</h1><p>Manage requests, customer messages, proof + quote approvals, payments, receipts, financials, production status, and showcase approvals.</p></div>
      <form action="/api/auth/logout" method="post"><input type="hidden" name="next" value="/admin/login" /><button className="btn secondary" type="submit">Sign out</button></form>
    </section>

    {error ? <div className="formError">The request database could not be loaded.</div> : null}

    <AdminWorkspace
      requests={rowsWithFiles}
      quotes={quotes}
      showcasePosts={showcaseWithPhotos}
      messageThreads={messageThreads}
      adminUsers={adminUsers}
      currentAdminUserId={auth.user.id}
      quoteReady={!quoteError && !proofItemError}
      showcaseReady={!showcaseError}
      messagesReady={!messageError && !messageEntryError && !messageAttachmentError}
      payments={payments}
      expenses={expenses}
      financialsReady={!paymentError && !expenseError && !expenseReceiptError}
    />
  </div>;
}
