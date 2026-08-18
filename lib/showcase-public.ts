export type ShowcasePublishedSnapshot = {
  customer_name?: string;
  business_name?: string | null;
  product?: string;
  rating?: number;
  review?: string;
  caption?: string | null;
  social_handle?: string | null;
};

export function publicShowcaseValues<T extends {
  status: string;
  customer_name: string;
  business_name: string | null;
  product: string;
  rating: number;
  review: string;
  caption: string | null;
  social_handle: string | null;
  photo_paths?: string[] | null;
  published_snapshot?: ShowcasePublishedSnapshot | null;
  published_photo_paths?: string[] | null;
}>(row: T) {
  const snapshot = row.status === "approved" ? null : row.published_snapshot;
  return {
    customer_name: snapshot?.customer_name ?? row.customer_name,
    business_name: snapshot?.business_name ?? row.business_name,
    product: snapshot?.product ?? row.product,
    rating: Number(snapshot?.rating ?? row.rating),
    review: snapshot?.review ?? row.review,
    caption: snapshot?.caption ?? row.caption,
    social_handle: snapshot?.social_handle ?? row.social_handle,
    photo_paths: row.status === "approved" ? (row.photo_paths ?? []) : (row.published_photo_paths ?? []),
  };
}
