import Link from "next/link";
import { getAdminAuthState } from "@/lib/auth";
import OrganizerTracker from "./OrganizerTracker";
import styles from "../page.module.css";

export const metadata = { title: "Beach House 2027 | Organizer", robots: { index: false, follow: false } };

export default async function OrganizerPage() {
  const state = await getAdminAuthState();
  const allowed = state.isAdmin && state.hasMfa && state.aal2;
  return <div className={styles.page}><section className={styles.section}>
    <h1>Beach-house organizer</h1>
    <p>Match recorded contributions to Cash App, then confirm them here.</p>
    <Link href="/beach-house-2027">Back to the payment plan</Link>
    {allowed ? <OrganizerTracker /> : <><p>Sign in to your Moore Made admin account and complete authenticator verification, then return to this page.</p><Link className={styles.button} href={state.isAdmin ? "/admin" : "/admin/login"}>Open staff sign-in</Link></>}
  </section></div>;
}
