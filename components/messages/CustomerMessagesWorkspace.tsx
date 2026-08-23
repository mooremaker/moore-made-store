"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CustomerMessageThread, MessageTopic } from "@/lib/message-types";
import { MESSAGE_STATUS_LABELS, MESSAGE_TOPIC_LABELS } from "@/lib/message-types";
import { formatRequestNumber } from "@/lib/custom-request-types";

type OrderOption = { id: string; requestNumber: number; product: string };

type Props = {
  threads: CustomerMessageThread[];
  orders: OrderOption[];
  initialThreadId?: string | null;
  initialRequestId?: string | null;
};

function timeLabel(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function dateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const key = (item: Date) => `${item.getFullYear()}-${item.getMonth()}-${item.getDate()}`;
  if (key(date) === key(today)) return "Today";
  if (key(date) === key(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" }).format(date);
}

function displayThreadSubject(subject: string) {
  // The order reference is already displayed directly above the subject. Keep
  // it in the stored subject/email history, but avoid repeating it in narrow UI.
  const withoutRepeatedReference = subject.replace(/^MM-\d{6}\s*[·-]\s*/i, "").trim();
  return withoutRepeatedReference || subject;
}

export function CustomerMessagesWorkspace({ threads, orders, initialThreadId, initialRequestId }: Props) {
  const router = useRouter();
  const initialOrderThread = initialRequestId ? threads.find((thread) => thread.requestId === initialRequestId)?.id : null;
  const [selectedId, setSelectedId] = useState(initialThreadId || initialOrderThread || threads[0]?.id || null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialThreadId && threads.some((thread) => thread.id === initialThreadId)) setSelectedId(initialThreadId);
  }, [initialThreadId, threads]);

  const selected = useMemo(() => threads.find((thread) => thread.id === selectedId) ?? null, [threads, selectedId]);
  const totalUnread = threads.reduce((sum, thread) => sum + thread.customerUnreadCount, 0);
  const groupedThreads = useMemo(() => {
    const sorted = [...threads].sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    const orderGroups = new Map<string, { key: string; label: string; product: string | null; latest: number; threads: CustomerMessageThread[] }>();
    const general: CustomerMessageThread[] = [];
    for (const thread of sorted) {
      if (!thread.requestId || !thread.requestNumber) {
        general.push(thread);
        continue;
      }
      const key = thread.requestId;
      const existing = orderGroups.get(key);
      if (existing) existing.threads.push(thread);
      else orderGroups.set(key, {
        key,
        label: formatRequestNumber(thread.requestNumber),
        product: thread.requestProduct,
        latest: new Date(thread.lastMessageAt).getTime(),
        threads: [thread],
      });
    }
    const groups = Array.from(orderGroups.values()).sort((a, b) => b.latest - a.latest);
    return general.length ? [...groups, { key: "general", label: "General messages", product: null, latest: -1, threads: general }] : groups;
  }, [threads]);

  useEffect(() => {
    if (!selected || selected.customerUnreadCount < 1) return;
    fetch(`/api/messages/threads/${selected.id}/read`, { method: "POST" }).then(() => router.refresh()).catch(() => undefined);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseThread(id: string) {
    setSelectedId(id);
    router.replace(`/account/messages?thread=${encodeURIComponent(id)}`);
  }

  async function createThread(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/messages/threads", { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    setSending(false);
    if (!response.ok) { setError(data.error || "Could not send your message."); return; }
    setSelectedId(data.threadId);
    router.replace(`/account/messages?thread=${encodeURIComponent(data.threadId)}`);
    router.refresh();
  }

  async function reply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSending(true); setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch(`/api/messages/threads/${selected.id}/messages`, { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    setSending(false);
    if (!response.ok) { setError(data.error || "Could not send your reply."); return; }
    formElement.reset();
    router.refresh();
  }

  return (
    <div className="messagesWorkspace customerMessagesWorkspace">
      <aside className="customerMessageSidebar">
        <section className="messageInbox card">
          <div className="messageInboxHead"><div><div className="eyebrow">Inbox</div><h2>Messages{totalUnread ? ` · ${totalUnread}` : ""}</h2><p>Email updates and conversations appear together.</p></div></div>
          <div className="messageThreadList">
            {groupedThreads.map((group) => <section className="messageOrderGroup" key={group.key}>
              <div className="messageOrderGroupHead"><div><strong>{group.label}</strong>{group.product ? <span>{group.product}</span> : null}</div><time>{dateLabel(group.threads[0].lastMessageAt)}</time></div>
              <div className="messageOrderGroupThreads">{group.threads.map((thread) => {
                const latest = thread.entries.at(-1);
                return <button key={thread.id} type="button" className={`messageThreadRow ${selectedId === thread.id ? "active" : ""}`} onClick={() => chooseThread(thread.id)}>
                  <div className="messageThreadRowTop"><strong>{displayThreadSubject(thread.subject)}</strong>{thread.customerUnreadCount ? <span className="messageUnreadBadge">{thread.customerUnreadCount}</span> : null}</div>
                  <span>{MESSAGE_TOPIC_LABELS[thread.topic]}</span>
                  <p>{latest?.body || "No messages yet."}</p>
                  <small>{timeLabel(thread.lastMessageAt)}</small>
                </button>;
              })}</div>
            </section>)}
            {!threads.length ? <p className="muted messageInboxEmpty">No conversations or email updates yet.</p> : null}
          </div>
        </section>

        <details className="messageStartConversation card" open={threads.length === 0 || Boolean(initialRequestId && !initialOrderThread)}>
          <summary><div><div className="eyebrow">Contact Moore Made</div><strong>Start a conversation</strong><span>Order, artwork, payment, delivery, or general help.</span></div><i>+</i></summary>
          <form className="messageCreateForm" onSubmit={createThread}>
            <div className="field"><label htmlFor="messageRequestId">Is this about an order?</label><select id="messageRequestId" name="requestId" defaultValue={initialRequestId || ""}><option value="">No — general question</option>{orders.map((order) => <option key={order.id} value={order.id}>{formatRequestNumber(order.requestNumber)} · {order.product}</option>)}</select></div>
            <div className="twoCol messageNewMeta">
              <div className="field"><label htmlFor="messageTopic">Topic</label><select id="messageTopic" name="topic" defaultValue="other">{(Object.keys(MESSAGE_TOPIC_LABELS) as MessageTopic[]).filter((value) => value !== "order").map((value) => <option key={value} value={value}>{MESSAGE_TOPIC_LABELS[value]}</option>)}</select></div>
              <div className="field"><label htmlFor="messageSubject">Subject</label><input id="messageSubject" name="subject" maxLength={180} placeholder="What can we help with?" /></div>
            </div>
            <div className="field"><label htmlFor="newMessageBody">Message</label><textarea id="newMessageBody" name="body" maxLength={6000} placeholder="Tell the Moore Made team what you need..." /></div>
            <div className="field"><label htmlFor="newMessageFiles">Attachments <small>Optional</small></label><input id="newMessageFiles" name="files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" /><span className="fieldHelp">Up to 10 PNG, JPG, WEBP, or PDF files per message, 20 MB each.</span></div>
            {error ? <div className="formError">{error}</div> : null}
            <div className="messageComposerActions"><button className="btn" disabled={sending} type="submit">{sending ? "Sending..." : "Send message"}</button></div>
          </form>
        </details>
      </aside>

      <section className="messageConversation card">
        {selected ? (
          <>
            <div className="messageConversationHead">
              <div><div className="eyebrow">{selected.requestNumber ? formatRequestNumber(selected.requestNumber) : "General question"}</div><h2>{displayThreadSubject(selected.subject)}</h2><p>{MESSAGE_TOPIC_LABELS[selected.topic]} · {MESSAGE_STATUS_LABELS[selected.status]}</p></div>
              {selected.requestId ? <Link className="btn secondary messageOrderLink" href="/account">View order</Link> : null}
            </div>
            <div className="messageHistory">
              {selected.entries.map((entry, index) => {
                const previous = selected.entries[index - 1];
                const showDate = !previous || dateLabel(previous.createdAt) !== dateLabel(entry.createdAt);
                return <div className="messageHistoryItem" key={entry.id}>
                  {showDate ? <div className="messageDateDivider"><span>{dateLabel(entry.createdAt)}</span></div> : null}
                  <article className={`messageBubble ${entry.senderRole === "customer" ? "fromCustomer" : entry.senderRole === "system" ? "fromSystem" : "fromAdmin"}`}>
                    <div className="messageBubbleMeta"><strong>{entry.senderRole === "customer" ? "You" : entry.senderRole === "system" ? "Email notification" : entry.senderDisplayName}</strong><span>{timeLabel(entry.createdAt)}</span></div>
                    <p>{entry.body}</p>
                    {entry.attachments.length ? <div className="messageAttachments">{entry.attachments.map((file) => <a key={file.id} href={file.url} target="_blank" rel="noreferrer">{file.originalName} ↗</a>)}</div> : null}
                  </article>
                </div>;
              })}
            </div>
            {selected.status === "archived" ? <div className="requestNote">This conversation has been archived. Start a new message if you still need help.</div> : (
              <form className="messageComposer" onSubmit={reply}>
                <div className="field"><label htmlFor="replyBody">Reply</label><textarea id="replyBody" name="body" maxLength={6000} placeholder="Write a message..." /></div>
                <div className="messageComposerBottom"><label className="messageAttachButton">Attach files<input name="files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" /></label><button className="btn" type="submit" disabled={sending}>{sending ? "Sending..." : "Send reply"}</button></div>
                {error ? <div className="formError">{error}</div> : null}
              </form>
            )}
          </>
        ) : <div className="empty"><h2>Your communication history will appear here.</h2><p>Expand “Start a conversation” whenever you need Moore Made.</p></div>}
      </section>
    </div>
  );
}
