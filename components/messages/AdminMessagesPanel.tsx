"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminMessageThread, AdminUserOption, MessageThreadStatus } from "@/lib/message-types";
import { MESSAGE_STATUS_LABELS, MESSAGE_TOPIC_LABELS } from "@/lib/message-types";
import { formatRequestNumber } from "@/lib/custom-request-types";

type Props = { threads: AdminMessageThread[]; adminUsers: AdminUserOption[]; currentAdminUserId: string };
type InboxFilter = "unread" | "open" | "resolved" | "archived" | "all";

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function AdminMessagesPanel({ threads, adminUsers, currentAdminUserId }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<InboxFilter>(threads.some((thread) => thread.adminUnreadCount > 0) ? "unread" : "open");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(threads.find((thread) => thread.adminUnreadCount > 0)?.id || threads[0]?.id || null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return threads.filter((thread) => {
      if (filter === "unread" && thread.adminUnreadCount < 1) return false;
      if (["open","resolved","archived"].includes(filter) && thread.status !== filter) return false;
      if (!needle) return true;
      return [thread.subject, thread.customerName, thread.customerEmail, thread.requestNumber ? formatRequestNumber(thread.requestNumber) : "", thread.requestProduct || ""]
        .join(" ").toLowerCase().includes(needle);
    });
  }, [threads, filter, query]);

  const selected = threads.find((thread) => thread.id === selectedId) ?? visible[0] ?? null;
  const unreadCount = threads.reduce((sum, thread) => sum + thread.adminUnreadCount, 0);

  useEffect(() => {
    if (!selected || selected.adminUnreadCount < 1) return;
    fetch(`/api/admin/messages/${selected.id}/read`, { method: "POST" }).then(() => router.refresh()).catch(() => undefined);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectThread(id: string) { setSelectedId(id); setError(""); }

  async function sendReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSending(true); setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch(`/api/admin/messages/${selected.id}/reply`, { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    setSending(false);
    if (!response.ok) { setError(data.error || "Could not save the reply."); return; }
    formElement.reset();
    router.refresh();
  }

  async function updateSettings(payload: { status?: MessageThreadStatus; assignedAdminUserId?: string | null }) {
    if (!selected) return;
    setError("");
    const response = await fetch(`/api/admin/messages/${selected.id}/settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "Could not update the conversation."); return; }
    router.refresh();
  }

  return (
    <section className="adminWorkspacePanel adminMessagesPanel">
      <div className="adminSectionIntro">
        <div><div className="eyebrow">Messages</div><h2>Customer inbox</h2><p>Order questions and general customer conversations stay together here instead of getting lost across texts and emails.</p></div>
        {unreadCount ? <span className="adminMessageUnreadTotal">{unreadCount} unread</span> : null}
      </div>

      <div className="adminMessageToolbar">
        <label className="adminSearch"><span className="srOnly">Search messages</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, order, subject…" /></label>
        <div className="adminFilterRow adminMessageFilters">
          {(["unread","open","resolved","archived","all"] as InboxFilter[]).map((value) => <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "unread" ? "Unread" : value.charAt(0).toUpperCase() + value.slice(1)}<span>{value === "unread" ? threads.filter((thread) => thread.adminUnreadCount > 0).length : value === "all" ? threads.length : threads.filter((thread) => thread.status === value).length}</span></button>)}
        </div>
      </div>

      <div className="adminMessageWorkspace">
        <div className="adminMessageList">
          {visible.length ? visible.map((thread) => (
            <button key={thread.id} type="button" className={`adminMessageRow ${selected?.id === thread.id ? "active" : ""}`} onClick={() => selectThread(thread.id)}>
              <div className="adminMessageRowTop"><strong>{thread.customerName}</strong>{thread.adminUnreadCount ? <span className="messageUnreadBadge">{thread.adminUnreadCount}</span> : null}</div>
              <span>{thread.requestNumber ? `${formatRequestNumber(thread.requestNumber)} · ${thread.requestProduct || "Order"}` : thread.subject}</span>
              <small>{thread.entries.at(-1)?.body || thread.subject}</small>
              <time>{dateTime(thread.lastMessageAt)}</time>
            </button>
          )) : <div className="empty adminMessageEmpty"><p>No conversations in this view.</p></div>}
        </div>

        <div className="adminMessageConversation">
          {selected ? <>
            <header className="adminMessageConversationHead">
              <div><div className="adminRequestKicker"><span className={`statusBadge message-status-${selected.status}`}>{MESSAGE_STATUS_LABELS[selected.status]}</span>{selected.requestNumber ? <span className="requestNumber">{formatRequestNumber(selected.requestNumber)}</span> : <span className="requestNumber">General</span>}</div><h3>{selected.subject}</h3><p>{MESSAGE_TOPIC_LABELS[selected.topic]} · {selected.customerEmail}</p></div>
              <div className="adminMessageContactActions">
                {selected.smsConsent && selected.customerPhone ? <a className="btn secondary" href={`sms:${selected.customerPhone}?&body=${encodeURIComponent(`Hi ${selected.customerName}, this is Moore Made regarding ${selected.requestNumber ? formatRequestNumber(selected.requestNumber) : "your message"}.`)}`}>Text customer</a> : null}
                <a className="btn secondary" href={`mailto:${selected.customerEmail}`}>Email</a>
                {selected.requestId ? <Link className="btn secondary" href={`/admin#order-${selected.requestId}`}>Open order</Link> : null}
              </div>
            </header>

            <div className="adminMessageSettings">
              <label><span>Status</span><select value={selected.status} onChange={(event) => updateSettings({ status: event.target.value as MessageThreadStatus })}><option value="open">Open</option><option value="resolved">Resolved</option><option value="archived">Archived</option></select></label>
              <label><span>Assigned to</span><select value={selected.assignedAdminUserId || ""} onChange={(event) => updateSettings({ assignedAdminUserId: event.target.value || null })}><option value="">Unassigned</option>{adminUsers.map((admin) => <option key={admin.id} value={admin.id}>{admin.id === currentAdminUserId ? `${admin.name} (me)` : admin.name}</option>)}</select></label>
              {!selected.assignedAdminUserId ? <button className="textButton" type="button" onClick={() => updateSettings({ assignedAdminUserId: currentAdminUserId })}>Assign to me</button> : null}
            </div>

            <div className="adminMessageHistory">
              {selected.entries.map((entry) => <article key={entry.id} className={`messageBubble adminMessageBubble ${entry.isInternal ? "internalNote" : entry.senderRole === "customer" ? "fromCustomer" : "fromAdmin"}`}>
                <div className="messageBubbleMeta"><strong>{entry.isInternal ? `Internal note · ${entry.senderDisplayName}` : entry.senderRole === "customer" ? selected.customerName : entry.senderDisplayName}</strong><span>{dateTime(entry.createdAt)}</span></div>
                <p>{entry.body}</p>
                {entry.attachments.length ? <div className="messageAttachments">{entry.attachments.map((file) => <a key={file.id} href={file.url} target="_blank" rel="noreferrer">{file.originalName} ↗</a>)}</div> : null}
              </article>)}
            </div>

            <form className="adminMessageComposer" onSubmit={sendReply}>
              <div className="field"><label htmlFor="adminMessageReply">Reply</label><textarea id="adminMessageReply" name="body" maxLength={6000} placeholder="Write a customer reply or internal note..." /></div>
              <div className="adminMessageComposerOptions">
                <label className="consentBox adminInternalToggle"><input type="checkbox" name="internal" value="true" /><span><strong>Internal note</strong><small>Visible only to Moore Made admins. The customer will not be notified.</small></span></label>
                <label className="messageAttachButton">Attach files<input name="files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" /></label>
              </div>
              {error ? <div className="formError">{error}</div> : null}
              <div className="messageComposerActions"><button className="btn" disabled={sending} type="submit">{sending ? "Saving..." : "Send / save note"}</button></div>
            </form>
          </> : <div className="empty"><h3>Select a conversation.</h3></div>}
        </div>
      </div>
    </section>
  );
}
