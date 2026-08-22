import { redirect } from "next/navigation";
import { getAdminAuthState } from "@/lib/auth";
import type { RequestStatus } from "@/lib/custom-request-types";
import type { ShowcaseStatus } from "@/lib/showcase-types";
import { normalizeShowcasePhotoPreviewMap } from "@/lib/showcase-photo-preview";
import { CUSTOM_REQUEST_BUCKET, QUOTE_PROOF_BUCKET, getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";
import type { QuoteRecord } from "@/lib/quote-types";
import type { DiscountCodeRecord } from "@/lib/discount-types";
import { AdminWorkspace, type AdminRequestRow, type AdminShowcaseRow } from "@/components/AdminWorkspace";
import { MESSAGE_BUCKET } from "@/lib/message-server";
import type { AdminMessageThread, AdminUserOption, MessageAttachment, MessageEntry, MessageTopic, MessageThreadStatus } from "@/lib/message-types";
import { EXPENSE_RECEIPT_BUCKET, FUNDING_DOCUMENT_BUCKET, type BusinessExpenseReceipt, type BusinessExpenseRow, type BusinessFinanceAuditRow, type BusinessFundingDocument, type BusinessFundingRow, type BusinessGoalFundingRow, type BusinessGoalRow, type FinancialPaymentRow } from "@/lib/finance-types";
import { FINAL_SALE_POLICY_VERSION } from "@/lib/payment-policy";
import type { StructuredOrderItem, ShippingAddress } from "@/lib/order-types";
import type { BusinessSettingsRecord, ProductPricingRecord } from "@/lib/pricing-types";

export const metadata = { robots: { index: false, follow: false } };

type RequestRow = { id:string; request_number:number; customer_name:string; email:string; phone:string|null; sms_consent:boolean; product:string; quantity:number; item_type:string|null; colors:string|null; sizes:string|null; logo_size:string|null; print_sides:string|null; placements:string[]|null; artwork_instructions:string|null; deadline:string|null; delivery:string|null; notes:string|null; requested_discount_code:string|null; order_items:StructuredOrderItem[]; shipping_address:ShippingAddress|null; status:RequestStatus; payment_status:"unpaid"|"deposit_paid"|"paid"; amount_paid_cents:number; artwork_paths:string[]|null; tracking_number:string|null; tracking_url:string|null; fulfillment_note:string|null; fulfillment_notified_at:string|null; estimated_fulfillment_date:string|null; estimated_fulfillment_note:string|null; estimated_fulfillment_notified_at:string|null; estimated_fulfillment_notified_for_date:string|null; cash_payment_request_status:"none"|"pending"|"contacted"|"completed"|"cancelled"; cash_payment_requested_at:string|null; cash_payment_requested_amount_cents:number|null; cash_payment_contacted_at:string|null; created_at:string; };
type ShowcaseRow = { id:string; customer_name:string; business_name:string|null; email:string; product:string; rating:number; review:string; caption:string|null; social_handle:string|null; status:ShowcaseStatus; homepage_featured:boolean; photo_paths:string[]|null; photo_preview_settings:unknown; created_at:string; };
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
    .select("id,request_number,customer_name,email,phone,sms_consent,product,quantity,item_type,colors,sizes,logo_size,print_sides,placements,artwork_instructions,deadline,delivery,notes,requested_discount_code,order_items,shipping_address,status,payment_status,amount_paid_cents,artwork_paths,tracking_number,tracking_url,fulfillment_note,fulfillment_notified_at,estimated_fulfillment_date,estimated_fulfillment_note,estimated_fulfillment_notified_at,estimated_fulfillment_notified_for_date,cash_payment_request_status,cash_payment_requested_at,cash_payment_requested_amount_cents,cash_payment_contacted_at,created_at")
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
    .select("id,request_id,public_token,status,line_items,setup_fee_cents,shipping_cents,tax_cents,tax_mode,stripe_tax_calculation_id,tax_calculated_at,tax_exempt_reason,tax_breakdown,tax_input_fingerprint,discount_cents,manual_discount_cents,promo_discount_cents,discount_code_id,applied_discount_code,subtotal_cents,total_cents,payment_terms,deposit_amount_cents,internal_supply_cost_cents,internal_print_cost_cents,internal_packaging_cost_cents,internal_shipping_cost_cents,internal_payment_fee_cents,internal_other_cost_cents,labor_hours,labor_rate_cents,labor_cost_cents,internal_total_cost_cents,estimated_profit_cents,estimated_margin_basis_points,revision_number,revision_reason,notes,valid_until,proof_paths,proof_notes,proof_version,customer_change_request,mockup_snapshot,sent_at,responded_at,created_at,updated_at");
  const baseQuotes = (quoteData ?? []) as QuoteRecord[];

  const { data: quoteRevisionData, error: quoteRevisionError } = await supabase
    .from("quote_revisions")
    .select("id,quote_id,revision_number,status,revision_reason,total_cents,estimated_profit_cents,estimated_margin_basis_points,proof_version,sent_at,responded_at,created_at")
    .order("revision_number", { ascending: false });
  type QuoteRevisionRow = { id:string; quote_id:string; revision_number:number; status:QuoteRecord["status"]; revision_reason:string|null; total_cents:number; estimated_profit_cents:number; estimated_margin_basis_points:number; proof_version:number; sent_at:string|null; responded_at:string|null; created_at:string; };
  const quoteRevisionRows = (quoteRevisionData ?? []) as QuoteRevisionRow[];

  const { data: policyAcceptanceData } = await supabase
    .from("order_policy_acceptances")
    .select("quote_id,proof_version,policy_version,accepted_at")
    .eq("policy_version", FINAL_SALE_POLICY_VERSION);
  type PolicyAcceptanceRow = { quote_id:string; proof_version:number; policy_version:string; accepted_at:string; };
  const policyAcceptances = (policyAcceptanceData ?? []) as PolicyAcceptanceRow[];

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

    const policyAcceptance = policyAcceptances.find((row) => row.quote_id === quote.id && Number(row.proof_version) === Math.max(1, Number(quote.proof_version || 1)));
    return {
      ...quote,
      proofItems,
      proofItemsVersion: adminVersion,
      changeRequests,
      revisions: quoteRevisionRows.filter((row) => row.quote_id === quote.id).map(({ quote_id: _quoteId, ...row }) => row),
      paymentPolicyAccepted: Boolean(policyAcceptance),
      paymentPolicyAcceptedAt: policyAcceptance?.accepted_at || null,
    };
  }));

  const { data: showcaseData, error: showcaseError } = await supabase
    .from("showcase_posts")
    .select("id,customer_name,business_name,email,product,rating,review,caption,social_handle,status,homepage_featured,photo_paths,photo_preview_settings,created_at")
    .neq("status", "draft")
    .order("created_at", { ascending: false });
  const showcaseRows = (showcaseData ?? []) as ShowcaseRow[];
  const showcaseWithPhotos: AdminShowcaseRow[] = await Promise.all(showcaseRows.map(async (row) => {
    const previewMap = normalizeShowcasePhotoPreviewMap(row.photo_preview_settings);
    return {
      ...row,
      photoLinks: (await Promise.all((row.photo_paths ?? []).map(async (path) => {
        const { data: signed } = await supabase.storage.from("showcase-files").createSignedUrl(path, 3600);
        return signed?.signedUrl ? { path, url: signed.signedUrl, preview: previewMap[path] ?? { x: 50, y: 50, zoom: 1 } } : null;
      }))).filter(Boolean) as AdminShowcaseRow["photoLinks"],
    };
  }));

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
    .select("id,request_id,quote_id,payment_kind,amount_cents,currency,status,payment_method,manual_reference,payer_name,payer_email,voided_at,void_reason,paid_at,created_at,receipt_number,receipt_token")
    .order("created_at", { ascending: false });
  const payments = (paymentData ?? []) as FinancialPaymentRow[];

  const { data: expenseData, error: expenseError } = await supabase
    .from("business_expenses")
    .select("id,expense_date,vendor,category,description,amount_cents,payment_method,note,recorded_by,created_at,updated_at,voided_at,void_reason")
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


  const { data: fundingData, error: fundingError } = await supabase
    .from("business_funding_entries")
    .select("id,entry_date,party_name,party_kind,entry_type,amount_cents,payment_method,reference,note,ownership_percent,recorded_by,voided_at,void_reason,created_at")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  const baseFunding = (fundingData ?? []) as BusinessFundingRow[];

  const { data: fundingDocumentData, error: fundingDocumentError } = await supabase
    .from("business_funding_documents")
    .select("id,funding_entry_id,storage_path,original_filename,mime_type,size_bytes,created_at")
    .order("created_at", { ascending: true });
  const fundingDocuments = (fundingDocumentData ?? []) as BusinessFundingDocument[];
  const signedFundingDocumentById = new Map<string, string>();
  if (!fundingDocumentError) {
    for (const document of fundingDocuments) {
      const { data: signed } = await supabase.storage.from(FUNDING_DOCUMENT_BUCKET).createSignedUrl(document.storage_path, 3600);
      if (signed?.signedUrl) signedFundingDocumentById.set(document.id, signed.signedUrl);
    }
  }
  const funding: BusinessFundingRow[] = baseFunding.map((entry) => ({
    ...entry,
    documents: fundingDocuments
      .filter((document) => document.funding_entry_id === entry.id)
      .map((document) => ({ ...document, url: signedFundingDocumentById.get(document.id) || null })),
  }));

  const { data: goalData, error: goalError } = await supabase
    .from("business_goals")
    .select("id,name,description,target_amount_cents,priority,status,target_date,funding_source,note,created_by,voided_at,void_reason,created_at,updated_at")
    .order("created_at", { ascending: false });
  const baseGoals = (goalData ?? []) as BusinessGoalRow[];

  const { data: goalFundingData, error: goalFundingError } = await supabase
    .from("business_goal_funding")
    .select("id,goal_id,entry_date,direction,amount_cents,funding_source,note,recorded_by,created_at")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  const goalFunding = (goalFundingData ?? []) as BusinessGoalFundingRow[];
  const goals: BusinessGoalRow[] = baseGoals.map((goal) => ({
    ...goal,
    funding_entries: goalFunding.filter((entry) => entry.goal_id === goal.id),
  }));

  const { data: financeAuditData, error: financeAuditError } = await supabase
    .from("business_finance_audit")
    .select("id,occurred_at,entity_type,entity_id,action,actor_user_id,before_data,after_data")
    .order("occurred_at", { ascending: false })
    .limit(150);
  const financeAudit = (financeAuditData ?? []) as BusinessFinanceAuditRow[];

  const { data: discountCodeData, error: discountCodeError } = await supabase
    .from("discount_codes")
    .select("id,code,description,kind,percent_off,amount_off_cents,min_order_cents,max_uses,per_customer_limit,starts_at,expires_at,active,retired_at,created_at,updated_at,discount_redemptions(id,quote_id,request_id,customer_email,discount_cents,redeemed_at)")
    .order("created_at", { ascending: false });
  const discountCodes = (discountCodeData ?? []) as unknown as DiscountCodeRecord[];

  const { data: productPricingData, error: productPricingError } = await supabase
    .from("product_pricing")
    .select("product_slug,product_name,active,blank_cost_cents,print_cost_cents,packaging_cost_cents,default_labor_hours,labor_rate_cents,target_margin_basis_points,tax_code,notes,created_at,updated_at")
    .order("product_name", { ascending: true });
  const productPricing = (productPricingData ?? []) as ProductPricingRecord[];

  const { data: businessSettingsData, error: businessSettingsError } = await supabase
    .from("business_settings")
    .select("id,default_labor_rate_cents,minimum_labor_hours,pickup_address,default_tax_code,shipping_tax_code,updated_at")
    .eq("id", "default")
    .maybeSingle();
  const businessSettings = (businessSettingsData ?? null) as BusinessSettingsRecord | null;

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
      <div><div className="eyebrow">Moore Made private admin</div><h1>Business command center.</h1><p>Move between orders, customers, production, financials, business goals, and tax-ready records without leaving the admin.</p></div>
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
      funding={funding}
      goals={goals}
      financeAudit={financeAudit}
      financialsReady={!paymentError && !expenseError && !expenseReceiptError}
      fundingReady={!fundingError && !fundingDocumentError}
      goalsReady={!goalError && !goalFundingError}
      auditReady={!financeAuditError}
      discountCodes={discountCodes}
      discountsReady={!discountCodeError && !quoteRevisionError}
      productPricing={productPricing}
      businessSettings={businessSettings}
      pricingReady={!productPricingError && !businessSettingsError}
    />
  </div>;
}
