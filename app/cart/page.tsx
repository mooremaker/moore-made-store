import { CustomRequestCartCheckout } from "@/components/shop/CustomRequestCartCheckout";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Request Cart | Moore Made" };
export const dynamic = "force-dynamic";

export default async function CartPage() {
  const user = await getCurrentUser();
  let profile: { full_name: string | null; phone: string | null } | null = null;
  if (user) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("profiles").select("full_name,phone").eq("id", user.id).maybeSingle();
    profile = data;
  }

  return (
    <div className="shell requestCartPage">
      <section className="pageHero requestCartHero">
        <div className="eyebrow">Custom request cart</div>
        <h1>Your ideas, all together.</h1>
        <p className="lead">Review every custom product and mockup, add more if you want, then send one organized request to Moore Made.</p>
      </section>
      <CustomRequestCartCheckout initialName={profile?.full_name ?? ""} initialEmail={user?.email ?? ""} initialPhone={profile?.phone ?? ""} signedIn={Boolean(user)} />
    </div>
  );
}
