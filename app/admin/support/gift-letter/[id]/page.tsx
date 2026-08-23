import { redirect } from "next/navigation";
import { GiftLetterDocument } from "@/components/admin/GiftLetterDocument";
import { getAdminAuthState } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const metadata = { title: "Moore Made Gift Letter", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function GiftLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getAdminAuthState();
  if (!auth.user) redirect("/admin/login");
  if (!auth.isAdmin || !auth.hasMfa || !auth.aal2) redirect("/admin");
  const { id } = await params;
  const { data } = await getSupabaseAdmin().from("support_inquiries").select("id,name").eq("id", id).maybeSingle();
  if (!data) redirect("/admin");
  return <GiftLetterDocument donorName={data.name} inquiryId={data.id} />;
}
