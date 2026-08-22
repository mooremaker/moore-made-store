import Link from "next/link";
import { notFound } from "next/navigation";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const metadata = {
  title: "Finished Product Photos | Moore Made",
  robots: { index: false, follow: false },
};

const BUCKET = "finished-product-files";

export default async function FinishedProductPhotosPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = getSupabaseAdmin();
  const { data: order } = await supabase
    .from("custom_requests")
    .select("id,request_number,customer_name,product,finished_photo_token")
    .eq("finished_photo_token", token)
    .maybeSingle();

  if (!order) notFound();

  const { data: rows } = await supabase
    .from("order_finished_photos")
    .select("id,storage_path,original_filename,sort_order,created_at")
    .eq("request_id", order.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const photos = (await Promise.all((rows ?? []).map(async (photo) => {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(photo.storage_path, 3600);
    return signed?.signedUrl ? { ...photo, url: signed.signedUrl } : null;
  }))).filter(Boolean);

  return (
    <main className="finishedGalleryPage">
      <section className="finishedGalleryCard">
        <div className="eyebrow">Moore Made · {formatRequestNumber(order.request_number)}</div>
        <h1>Your finished product photos.</h1>
        <p>{order.product} · These are the completed items from your Moore Made order.</p>

        {photos.length ? <div className="finishedGalleryGrid">
          {photos.map((photo, index) => <a href={photo?.url} target="_blank" rel="noreferrer" key={photo?.id}>
            <img src={photo?.url} alt={`Finished product photo ${index + 1}`} />
            <span>Photo {index + 1}</span>
          </a>)}
        </div> : <div className="empty"><h3>No photos are available yet.</h3><p>Moore Made may still be preparing this order's finished product photos.</p></div>}

        <div className="finishedGalleryFooter">
          <p>Tap any photo to open it larger.</p>
          <Link className="btn secondary" href="/">Moore Made home</Link>
        </div>
      </section>
    </main>
  );
}
