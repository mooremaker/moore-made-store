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
        <p className="lead">
          Tell us as much as you know. If you are not sure about a detail, leave it blank or write “not sure” — we can work through the rest with you.
        </p>
        <div className="accountTrackingPrompt">{user ? <>Signed in as <strong>{user.email}</strong>. This request will be attached to your account automatically.</> : <>Want to track this request online? <Link href="/account/login?next=/custom-orders"><strong>Sign in or create an account first</strong></Link>. You can still submit as a guest.</>}</div>
      </section>
      <CustomRequestForm initialName={profile?.full_name ?? ""} initialEmail={user?.email ?? ""} initialPhone={profile?.phone ?? ""} />
    </div>
  );
}
