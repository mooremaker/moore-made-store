import Link from "next/link";
import { CustomRequestForm } from "@/components/CustomRequestForm";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function CustomOrdersPage() {
  const user = await getCurrentUser();
  let profile: { full_name: string | null; phone: string | null } | null = null;
  if (user) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("profiles").select("full_name,phone").eq("id", user.id).maybeSingle();
    profile = data;
  }
  return (
    <div className="shell customOrderPage">
      <section className="pageHero customOrderHero">
        <div className="eyebrow">Made your way</div>
        <h1>Place a custom request.</h1>
        <p className="lead">Start with the basics. Everything else is optional, and “not sure” is completely fine.</p>
        <div className="accountTrackingPrompt requestTrackingBar">{user ? <div className="requestSignedInState"><div className="requestSignedCopy"><span>Signed in as</span><strong>{user.email}</strong></div><p>This request will be attached to your account automatically.</p></div> : <><div><strong>Want to track this request later?</strong><small>Sign in first, or continue below as a guest.</small></div><Link className="btn secondary" href="/account/login?next=/custom-orders">Sign in</Link></>}</div>
      </section>
      <CustomRequestForm initialName={profile?.full_name ?? ""} initialEmail={user?.email ?? ""} initialPhone={profile?.phone ?? ""} />
    </div>
  );
}
