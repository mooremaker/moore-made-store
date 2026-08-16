import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export type PublicShowcasePost = {
  id: string; customer_name: string; business_name: string | null; product: string; rating: number; review: string; caption: string | null; social_handle: string | null; created_at: string; photoUrls: string[];
};

export async function getApprovedShowcasePosts(limit?: number): Promise<PublicShowcasePost[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseAdmin();
  let query = supabase.from("showcase_posts").select("id,customer_name,business_name,product,rating,review,caption,social_handle,created_at,photo_paths").eq("status", "approved").order("approved_at", { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) return [];
  return Promise.all((data ?? []).map(async (row) => {
    const urls: string[] = [];
    for (const path of row.photo_paths ?? []) {
      const { data: signed } = await supabase.storage.from("showcase-files").createSignedUrl(path, 3600);
      if (signed?.signedUrl) urls.push(signed.signedUrl);
    }
    return { ...row, photoUrls: urls } as PublicShowcasePost;
  }));
}
