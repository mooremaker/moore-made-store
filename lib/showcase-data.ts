import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";
import { publicShowcaseValues, type ShowcasePublishedSnapshot } from "@/lib/showcase-public";
import { DEFAULT_SHOWCASE_PHOTO_PREVIEW, normalizeShowcasePhotoPreviewMap, type ShowcasePhotoPreview } from "@/lib/showcase-photo-preview";

export type PublicShowcasePost = {
  id: string; customer_name: string; business_name: string | null; product: string; rating: number; review: string; caption: string | null; social_handle: string | null; created_at: string; photoUrls: string[]; photoPreviews: ShowcasePhotoPreview[];
};

type Row = PublicShowcasePost & {
  status: string;
  photo_paths: string[] | null;
  published_snapshot: ShowcasePublishedSnapshot | null;
  published_photo_paths: string[] | null;
  published_at: string | null;
  photo_preview_settings: unknown;
};

export async function getApprovedShowcasePosts(limit?: number): Promise<PublicShowcasePost[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseAdmin();
  let query = supabase.from("showcase_posts")
    .select("id,customer_name,business_name,product,rating,review,caption,social_handle,created_at,status,photo_paths,published_snapshot,published_photo_paths,published_at,photo_preview_settings")
    .neq("status", "draft")
    .order("published_at", { ascending: false, nullsFirst: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) return [];
  const publicRows = ((data ?? []) as Row[]).filter((row) => row.status === "approved" || Boolean(row.published_snapshot));
  return Promise.all(publicRows.map(async (row) => {
    const values = publicShowcaseValues(row);
    const previewMap = normalizeShowcasePhotoPreviewMap(row.photo_preview_settings);
    const photos = (await Promise.all((values.photo_paths ?? []).map(async (path) => {
      const { data: signed } = await supabase.storage.from("showcase-files").createSignedUrl(path, 3600);
      return signed?.signedUrl ? { url: signed.signedUrl, preview: previewMap[path] ?? { ...DEFAULT_SHOWCASE_PHOTO_PREVIEW } } : null;
    }))).filter((photo): photo is { url: string; preview: ShowcasePhotoPreview } => photo !== null);
    return {
      id: row.id,
      customer_name: values.customer_name,
      business_name: values.business_name,
      product: values.product,
      rating: values.rating,
      review: values.review,
      caption: values.caption,
      social_handle: values.social_handle,
      created_at: row.published_at ?? row.created_at,
      photoUrls: photos.map((photo) => photo.url),
      photoPreviews: photos.map((photo) => photo.preview),
    };
  }));
}
