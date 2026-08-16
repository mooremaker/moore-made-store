import Link from "next/link";
import { redirect } from "next/navigation";
import { MagicLinkForm } from "@/components/auth/MagicLinkForm";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { robots: { index: false, follow: false } };

export default async function AccountLoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(params.next && params.next.startsWith("/") ? params.next : "/account");
  const next = params.next && params.next.startsWith("/") ? params.next : "/account";

  return (
    <div className="shell authPage">
      <section className="pageHero authHero">
        <div className="eyebrow">Your Moore Made account</div>
        <h1>Orders, proofs, all in one place.</h1>
        <p className="lead">Use a secure email link to sign in. Your account only shows orders and files connected to your verified email.</p>
      </section>
      {params.error ? <div className="formError authError">That sign-in link is invalid or expired. Request a fresh link below.</div> : null}
      <MagicLinkForm mode="customer" nextPath={next} />
      <p className="authFinePrint">You can still <Link href="/custom-orders"><strong>place a custom request without an account</strong></Link>. If you create an account later with the same verified email, eligible guest requests are attached automatically.</p>
    </div>
  );
}
