import { redirect } from "next/navigation";
import { MagicLinkForm } from "@/components/auth/MagicLinkForm";
import { getAdminAuthState } from "@/lib/auth";

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
  const state = await getAdminAuthState();
  if (state.user && state.isAdmin) redirect("/admin");

  return (
    <div className="shell authPage adminAuthPage">
      <section className="pageHero authHero">
        <div className="eyebrow">Moore Made private admin</div>
        <h1>Staff sign in.</h1>
        <p className="lead">Admin access uses an individual staff account plus authenticator-app verification. Shared admin passwords are no longer used.</p>
      </section>
      {state.user && !state.isAdmin ? <div className="formError authError">You are signed in, but this account has not been approved as a Moore Made administrator.</div> : null}
      <MagicLinkForm mode="admin" nextPath="/admin" />
    </div>
  );
}
