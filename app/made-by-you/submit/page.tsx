import { ShowcaseSubmitForm } from "@/components/ShowcaseSubmitForm";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export default async function ShareProjectPage({ searchParams }: { searchParams: Promise<{ review?: string }> }) {
  const user = await getCurrentUser();
  const { review } = await searchParams;
  const token = typeof review === "string" && /^[0-9a-f-]{36}$/i.test(review) ? review : "";
  const order = token && isSupabaseConfigured()
    ? (await getSupabaseAdmin().from("custom_requests").select("customer_name,email,product,request_number,status").eq("review_request_token", token).eq("status", "completed").maybeSingle()).data
    : null;
  return <div className="shell showcaseSubmitPage"><section className="pageHero showcaseSubmitHero"><div className="eyebrow">Made by You</div><h1>Show us how it turned out.</h1><p className="lead">{order ? `Thank you for your ${order.product} order. Your review and photos mean a lot to Moore Made.` : "Share photos of your Moore Made order and leave a review. Every submission is reviewed before it appears publicly."}</p></section><ShowcaseSubmitForm canSaveDraft={Boolean(user)} defaultEmail={order?.email || user?.email || ""} defaultName={order?.customer_name || ""} defaultProduct={order?.product || ""}/></div>;
}
