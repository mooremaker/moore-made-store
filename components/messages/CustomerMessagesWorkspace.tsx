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

export function CustomerMessagesWorkspace({ threads, orders, initialThreadId, initialRequestId }: Props) {
  const router = useRouter();
  const initialOrderThread = initialRequestId ? threads.find((thread) => thread.requestId === initialRequestId)?.id : null;
  const [selectedId, setSelectedId] = useState(initialThreadId || initialOrderThread || threads[0]?.id || null);
  const [creating, setCreating] = useState(Boolean(initialRequestId && !initialOrderThread) || threads.length === 0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialThreadId && threads.some((thread) => thread.id === initialThreadId)) setSelectedId(initialThreadId);
  }, [initialThreadId, threads]);

  const selected = useMemo(() => threads.find((thread) => thread.id === selectedId) ?? null, [threads, selectedId]);
  const totalUnread = threads.reduce((sum, thread) => sum + thread.customerUnreadCount, 0);

  useEffect(() => {
    if (!selected || selected.customerUnreadCount < 1) return;
    fetch(`/api/messages/threads/${selected.id}/read`, { method: "POST" }).then(() => router.refresh()).catch(() => undefined);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseThread(id: string) {
    setCreating(false);
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
    setCreating(false);
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
      <aside className="messageInbox card">
        <div className="messageInboxHead">
          <div><div className="eyebrow">Inbox</div><h2>Messages{totalUnread ? ` · ${totalUnread}` : ""}</h2></div>
          <button className="btn messageNewButton" type="button" onClick={() => { setCreating(true); setError(""); }}>New message</button>
        </div>
        <div className="messageThreadList">
          {threads.map((thread) => (
            <button key={thread.id} type="button" className={`messageThreadRow ${selectedId === thread.id && !creating ? "active" : ""}`} onClick={() => chooseThread(thread.id)}>
              <div className="messageThreadRowTop"><strong>{thread.subject}</strong>{thread.customerUnreadCount ? <span className="messageUnreadBadge">{thread.customerUnreadCount}</span> : null}</div>
              <span>{thread.requestNumber ? `${formatRequestNumber(thread.requestNumber)} · ` : ""}{MESSAGE_TOPIC_LABELS[thread.topic]}</span>
              <small>{timeLabel(thread.lastMessageAt)}</small>
            </button>
          ))}
          {!threads.length ? <p className="muted messageInboxEmpty">No conversations yet.</p> : null}
        </div>
      </aside>

      <section className="messageConversation card">
        {creating ? (
          <form className="messageCreateForm" onSubmit={createThread}>
            <div className="messageConversationHead"><div><div className="eyebrow">Contact Moore Made</div><h2>Start a conversation</h2><p>Ask about an order, product, artwork, payment, pickup, local delivery, shipping, or anything else.</p></div></div>
            <div className="field"><label htmlFor="messageRequestId">Is this about an order?</label><select id="messageRequestId" name="requestId" defaultValue={initialRequestId || ""}><option value="">No — general question</option>{orders.map((order) => <option key={order.id} value={order.id}>{formatRequestNumber(order.requestNumber)} · {order.product}</option>)}</select></div>
            <div className="twoCol messageNewMeta">
              <div className="field"><label htmlFor="messageTopic">Topic</label><select id="messageTopic" name="topic" defaultValue="other">{(Object.keys(MESSAGE_TOPIC_LABELS) as MessageTopic[]).filter((value) => value !== "order").map((value) => <option key={value} value={value}>{MESSAGE_TOPIC_LABELS[value]}</option>)}</select></div>
              <div className="field"><label htmlFor="messageSubject">Subject</label><input id="messageSubject" name="subject" maxLength={180} placeholder="What can we help with?" /></div>
            </div>
            <div className="field"><label htmlFor="newMessageBody">Message</label><textarea id="newMessageBody" name="body" maxLength={6000} placeholder="Tell the Moore Made team what you need..." /></div>
            <div className="field"><label htmlFor="newMessageFiles">Attachments (optional)</label><input id="newMessageFiles" name="files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" /><span className="fieldHelp">Up to 10 PNG, JPG, WEBP, or PDF files per message, 20 MB each.</span></div>
            {error ? <div className="formError">{error}</div> : null}
            <div className="messageComposerActions"><button className="btn" disabled={sending} type="submit">{sending ? "Sending..." : "Send message"}</button>{threads.length ? <button className="btn secondary" type="button" onClick={() => setCreating(false)}>Cancel</button> : <Link className="btn secondary" href="/account">Back to account</Link>}</div>
          </form>
        ) : selected ? (
          <>
            <div className="messageConversationHead">
              <div><div className="eyebrow">{selected.requestNumber ? formatRequestNumber(selected.requestNumber) : "General question"}</div><h2>{selected.subject}</h2><p>{MESSAGE_TOPIC_LABELS[selected.topic]} · {MESSAGE_STATUS_LABELS[selected.status]}</p></div>
              {selected.requestId ? <Link className="btn secondary messageOrderLink" href="/account">View order</Link> : null}
            </div>
            <div className="messageHistory">
              {selected.entries.map((entry) => (
                <article key={entry.id} className={`messageBubble ${entry.senderRole === "customer" ? "fromCustomer" : "fromAdmin"}`}>
                  <div className="messageBubbleMeta"><strong>{entry.senderRole === "customer" ? "You" : entry.senderDisplayName}</strong><span>{timeLabel(entry.createdAt)}</span></div>
                  <p>{entry.body}</p>
                  {entry.attachments.length ? <div className="messageAttachments">{entry.attachments.map((file) => <a key={file.id} href={file.url} target="_blank" rel="noreferrer">{file.originalName} ↗</a>)}</div> : null}
                </article>
              ))}
            </div>
            {selected.status === "archived" ? <div className="requestNote">This conversation has been archived. Start a new message if you still need help.</div> : (
              <form className="messageComposer" onSubmit={reply}>
                <div className="field"><label htmlFor="replyBody">Reply</label><textarea id="replyBody" name="body" maxLength={6000} placeholder="Write a message..." /></div>
                <div className="messageComposerBottom"><label className="messageAttachButton">Attach files<input name="files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" /></label><button className="btn" type="submit" disabled={sending}>{sending ? "Sending..." : "Send reply"}</button></div>
                {error ? <div className="formError">{error}</div> : null}
              </form>
            )}
          </>
        ) : <div className="empty"><h2>Select a conversation.</h2></div>}
      </section>
    </div>
  );
}
