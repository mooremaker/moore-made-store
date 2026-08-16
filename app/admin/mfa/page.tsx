import { redirect } from "next/navigation";
import { AdminMfaGate } from "@/components/auth/AdminMfaGate";
import { getAdminAuthState } from "@/lib/auth";

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminMfaPage() {
  const state = await getAdminAuthState();
  if (!state.user) redirect("/admin/login");
  if (!state.isAdmin) redirect("/account");
  if (state.hasMfa && state.aal2) redirect("/admin");

  return (
    <div className="shell authPage adminMfaPage">
      <section className="pageHero authHero">
        <div className="eyebrow">Moore Made security</div>
        <h1>One more security check.</h1>
        <p className="lead">Customer orders contain private contact details and artwork, so administrator accounts require two-factor authentication.</p>
      </section>
      <AdminMfaGate initialMode={state.hasMfa ? "challenge" : "setup"} />
    </div>
  );
}
