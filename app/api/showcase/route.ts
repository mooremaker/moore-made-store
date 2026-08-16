import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BUCKET = "showcase-files";
const MAX_FILES = 5;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const text = (value: unknown, max = 4000) => typeof value === "string" ? value.trim().slice(0, max) : "";
const safeName = (name: string) => name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120) || "photo";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (text(body.website, 200)) return NextResponse.json({ ok: true });

    const name = text(body.name, 160);
    const email = text(body.email, 320).toLowerCase();
    const product = text(body.product, 300);
    const review = text(body.review, 4000);
    const rating = Number(body.rating);
    const permission = body.permission === true;
    const files = Array.isArray(body.files) ? body.files : [];

    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !product || !review || !permission || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Please complete the required fields and permission checkbox." }, { status: 400 });
    }
    if (!files.length || files.length > MAX_FILES) return NextResponse.json({ error: `Please upload 1 to ${MAX_FILES} photos.` }, { status: 400 });
    for (const file of files) {
      if (!file || typeof file.name !== "string" || typeof file.size !== "number" || !String(file.type || "").startsWith("image/")) return NextResponse.json({ error: "Please upload image files only." }, { status: 400 });
      if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: `${file.name} is larger than 15 MB.` }, { status: 400 });
    }

    const authClient = await createSupabaseServerClient();
    const { data: authData } = await authClient.auth.getUser();
    const customerUserId = authData.user?.id ?? null;

    const supabase = getSupabaseAdmin();
    const { data: created, error } = await supabase.from("showcase_posts").insert({
      customer_name: name,
      customer_user_id: customerUserId,
      business_name: text(body.businessName, 240) || null,
      email,
      product,
      rating: Math.round(rating),
      review,
      caption: text(body.caption, 4000) || null,
      social_handle: text(body.socialHandle, 160) || null,
      display_permission: true,
      status: "pending",
    }).select("id,submission_token").single();

    if (error || !created) return NextResponse.json({ error: "We could not save your post. Please try again." }, { status: 500 });

    const uploads = [] as Array<{ index: number; path: string; token: string }>;
    for (let index = 0; index < files.length; index++) {
      const path = `${created.id}/${Date.now()}-${index}-${safeName(files[index].name)}`;
      const { data } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (data?.token) uploads.push({ index, path, token: data.token });
    }

    return NextResponse.json({ ok: true, id: created.id, submissionToken: created.submission_token, uploads });
  } catch (error) {
    console.error("Showcase submit error", error);
    return NextResponse.json({ error: "Something went wrong while submitting your post." }, { status: 500 });
  }
}
