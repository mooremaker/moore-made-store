import { notFound, redirect } from "next/navigation";
import { ShowcaseEditorForm } from "@/components/ShowcaseEditorForm";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const metadata = { robots:{ index:false, follow:false } };

export default async function EditShowcasePage({ params }: { params: Promise<{ id:string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/account/login?next=/account/made-by-you/${id}`);
  const admin = getSupabaseAdmin();
  const { data: post } = await admin.from("showcase_posts").select("id,customer_user_id,customer_name,business_name,email,product,rating,review,caption,social_handle,display_permission,status,photo_paths,published_snapshot").eq("id",id).maybeSingle();
  if (!post || post.customer_user_id !== user.id) notFound();
  const photos = (await Promise.all((post.photo_paths ?? []).map(async (path:string) => { const { data } = await admin.storage.from("showcase-files").createSignedUrl(path,3600); return data?.signedUrl ? {path,url:data.signedUrl} : null; }))).filter(Boolean) as {path:string;url:string}[];
  return <div className="shell showcaseSubmitPage"><section className="pageHero showcaseSubmitHero"><div className="eyebrow">Made by You</div><h1>Edit your review.</h1><p className="lead">Save your work as a draft anytime. When you submit changes, Moore Made reviews them before they become public.</p></section><ShowcaseEditorForm initial={{ id:post.id,name:post.customer_name,businessName:post.business_name??"",email:post.email,product:post.product,rating:post.rating,review:post.review,caption:post.caption??"",socialHandle:post.social_handle??"",permission:Boolean(post.display_permission),status:post.status,hadPublishedVersion:Boolean(post.published_snapshot),photos }} /></div>;
}
