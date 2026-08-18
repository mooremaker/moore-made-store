import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";
import { publicShowcaseValues, type ShowcasePublishedSnapshot } from "@/lib/showcase-public";

export type PublicShowcasePost = {
  id: string; customer_name: string; business_name: string | null; product: string; rating: number; review: string; caption: string | null; social_handle: string | null; created_at: string; photoUrls: string[];
};

type Row = PublicShowcasePost & {
  status: string;
  photo_paths: string[] | null;
  published_snapshot: ShowcasePublishedSnapshot | null;
  published_photo_paths: string[] | null;
  published_at: string | null;
};

export async function getApprovedShowcasePosts(limit?: number): Promise<PublicShowcasePost[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseAdmin();
  let query = supabase.from("showcase_posts")
    .select("id,customer_name,business_name,product,rating,review,caption,social_handle,created_at,status,photo_paths,published_snapshot,published_photo_paths,published_at")
    .neq("status", "draft")
    .order("published_at", { ascending: false, nullsFirst: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) return [];
  const publicRows = ((data ?? []) as Row[]).filter((row) => row.status === "approved" || Boolean(row.published_snapshot));
  return Promise.all(publicRows.map(async (row) => {
    const values = publicShowcaseValues(row);
    const urls: string[] = [];
    for (const path of values.photo_paths ?? []) {
      const { data: signed } = await supabase.storage.from("showcase-files").createSignedUrl(path, 3600);
      if (signed?.signedUrl) urls.push(signed.signedUrl);
    }
    return { id:row.id, customer_name:values.customer_name, business_name:values.business_name, product:values.product, rating:values.rating, review:values.review, caption:values.caption, social_handle:values.social_handle, created_at:row.published_at ?? row.created_at, photoUrls:urls };
  }));
}
