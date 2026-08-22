import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";
import { publicShowcaseValues, type ShowcasePublishedSnapshot } from "@/lib/showcase-public";
import { DEFAULT_SHOWCASE_PHOTO_PREVIEW, normalizeShowcasePhotoPreviewMap, type ShowcasePhotoPreview } from "@/lib/showcase-photo-preview";

export type PublicShowcasePost = {
  id: string;
  customerGroupKey: string;
  homepageFeatured: boolean;
  customerPrimary: boolean;
  customer_name: string;
  business_name: string | null;
  product: string;
  rating: number;
  review: string;
  caption: string | null;
  social_handle: string | null;
  created_at: string;
  photoUrls: string[];
  photoPreviews: ShowcasePhotoPreview[];
};

type Row = {
  id: string;
  customer_user_id: string | null;
  email: string;
  customer_name: string;
  business_name: string | null;
  product: string;
  rating: number;
  review: string;
  caption: string | null;
  social_handle: string | null;
  created_at: string;
  status: string;
  photo_paths: string[] | null;
  published_snapshot: ShowcasePublishedSnapshot | null;
  published_photo_paths: string[] | null;
  published_at: string | null;
  photo_preview_settings: unknown;
  homepage_featured: boolean | null;
  customer_primary: boolean | null;
};

async function makeCustomerGroupKey(row: Pick<Row, "customer_user_id" | "email">) {
  const identity = row.customer_user_id
    ? `user:${row.customer_user_id}`
    : `email:${row.email.trim().toLowerCase()}`;

  try {
    const bytes = new TextEncoder().encode(identity);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return `customer-${Array.from(new Uint8Array(digest)).slice(0, 12).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    // Server runtimes used by Next support Web Crypto. This fallback keeps
    // grouping functional without exposing the raw email if a runtime ever
    // lacks crypto.subtle.
    let hash = 2166136261;
    for (let index = 0; index < identity.length; index += 1) {
      hash ^= identity.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `customer-${(hash >>> 0).toString(16)}`;
  }
}

export async function getApprovedShowcasePosts(limit?: number): Promise<PublicShowcasePost[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseAdmin();
  let query = supabase.from("showcase_posts")
    .select("id,customer_user_id,email,customer_name,business_name,product,rating,review,caption,social_handle,created_at,status,photo_paths,published_snapshot,published_photo_paths,published_at,photo_preview_settings,homepage_featured,customer_primary")
    .neq("status", "draft")
    .order("homepage_featured", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) return [];

  const publicRows = ((data ?? []) as Row[]).filter((row) => row.status === "approved" || Boolean(row.published_snapshot));

  return Promise.all(publicRows.map(async (row) => {
    const values = publicShowcaseValues(row);
    const previewMap = normalizeShowcasePhotoPreviewMap(row.photo_preview_settings);
    const customerGroupKey = await makeCustomerGroupKey(row);
    const photos = (await Promise.all((values.photo_paths ?? []).map(async (path) => {
      const { data: signed } = await supabase.storage.from("showcase-files").createSignedUrl(path, 3600);
      return signed?.signedUrl ? { url: signed.signedUrl, preview: previewMap[path] ?? { ...DEFAULT_SHOWCASE_PHOTO_PREVIEW } } : null;
    }))).filter((photo): photo is { url: string; preview: ShowcasePhotoPreview } => photo !== null);

    return {
      id: row.id,
      customerGroupKey,
      homepageFeatured: Boolean(row.homepage_featured),
      customerPrimary: Boolean(row.customer_primary),
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
