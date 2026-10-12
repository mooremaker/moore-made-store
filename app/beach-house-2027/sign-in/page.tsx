import { redirect } from "next/navigation";
import Link from "next/link";
import { MagicLinkForm } from "@/components/auth/MagicLinkForm";
import { getCurrentUser } from "@/lib/auth";
import styles from "../page.module.css";

export const metadata = { title: "Beach House 2027 | Sign in", robots: { index: false, follow: false } };

export default async function BeachSignInPage() {
  const user = await getCurrentUser();
  if (user) redirect("/beach-house-2027#my-progress");
  return <div className={styles.page}><section className={styles.section}>
    <h1>Save your beach-house progress</h1>
    <p>Sign in with an email code or secure link. Your payment history and checklist will follow you between devices.</p>
    <MagicLinkForm mode="customer" nextPath="/beach-house-2027#my-progress" />
    <p className={styles.small}>Your existing Moore Made account works here too.</p>
    <Link href="/beach-house-2027">Back to the payment plan</Link>
  </section></div>;
}
