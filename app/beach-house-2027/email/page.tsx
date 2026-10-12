import type { Metadata } from "next";
import Link from "next/link";
import styles from "../page.module.css";

export const metadata: Metadata = { title: "Beach House Email Updates", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function BeachEmailPage({ searchParams }: { searchParams: Promise<{ token?: string; action?: string; result?: string }> }) {
  const { token, action, result } = await searchParams;
  const unsubscribe = action === "unsubscribe";
  const valid = typeof token === "string" && /^[a-f0-9]{64}$/.test(token) && ["confirm", "unsubscribe"].includes(action || "");
  const messages: Record<string, string> = {
    confirmed: "You’re signed up! We’ll send reminders two weeks before, one week before, and on each upcoming payment date.",
    stopped: "You’ve unsubscribed from beach house payment reminders.",
    expired: "This link is invalid or expired. Return to the beach house page to request a new confirmation email.",
    unavailable: "We couldn’t update your reminders right now. Please try your link again shortly.",
  };
  return <div className={styles.page}><section className={styles.section}>
    <h1>{result ? "Email updates" : unsubscribe ? "Stop email reminders?" : "Confirm your email reminders"}</h1>
    {result ? <p>{messages[result] || messages.expired}</p> : valid ? <>
      <p>{unsubscribe ? "You’ll stop receiving beach house payment reminders." : "Get reminders two weeks before, one week before, and on each collection date."}</p>
      <form action="/api/beach-house-2027/subscription" method="POST"><input type="hidden" name="token" value={token} /><input type="hidden" name="action" value={action} /><button className={styles.button} type="submit">{unsubscribe ? "Unsubscribe" : "Confirm my reminders"}</button></form>
    </> : <p>{messages.expired}</p>}
    <Link href="/beach-house-2027">Back to the payment plan</Link>
  </section></div>;
}
