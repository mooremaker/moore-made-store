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

    const authClient = await createSupabaseServerClient();
    const { data: authData } = await authClient.auth.getUser();
    const user = authData.user ?? null;
    const action = body.action === "draft" ? "draft" : "submit";
    if (action === "draft" && !user) return NextResponse.json({ error: "Sign in to save a review draft." }, { status: 401 });

    const name = text(body.name, 160);
    const email = text(body.email, 320).toLowerCase();
    const product = text(body.product, 300);
    const review = text(body.review, 4000);
    const rating = Number(body.rating || 5);
    const permission = body.permission === true;
    const files = Array.isArray(body.files) ? body.files : [];

    if (action === "submit") {
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !product || !review || !permission || rating < 1 || rating > 5) {
        return NextResponse.json({ error: "Please complete the required fields and permission checkbox." }, { status: 400 });
      }
      if (files.length > MAX_FILES) return NextResponse.json({ error: `Please upload no more than ${MAX_FILES} photos.` }, { status: 400 });
    } else if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Drafts can have up to ${MAX_FILES} photos.` }, { status: 400 });
    }

    for (const file of files) {
      if (!file || typeof file.name !== "string" || typeof file.size !== "number" || !String(file.type || "").startsWith("image/")) return NextResponse.json({ error: "Please upload image files only." }, { status: 400 });
      if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: `${file.name} is larger than 15 MB.` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: created, error } = await supabase.from("showcase_posts").insert({
      customer_name: name || "Draft",
      customer_user_id: user?.id ?? null,
      business_name: text(body.businessName, 240) || null,
      email: email || user?.email || "",
      product: product || "Untitled review",
      rating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? Math.round(rating) : 5,
      review,
      caption: text(body.caption, 4000) || null,
      social_handle: text(body.socialHandle, 160) || null,
      display_permission: permission,
      status: action === "draft" ? "draft" : "pending",
      submitted_at: action === "submit" ? new Date().toISOString() : null,
    }).select("id,submission_token").single();

    if (error || !created) return NextResponse.json({ error: "We could not save your post. Please try again." }, { status: 500 });

    const uploads = [] as Array<{ index: number; path: string; token: string }>;
    for (let index = 0; index < files.length; index++) {
      const path = `${created.id}/${Date.now()}-${index}-${safeName(files[index].name)}`;
      const { data } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (data?.token) uploads.push({ index, path, token: data.token });
    }

    return NextResponse.json({ ok: true, id: created.id, submissionToken: created.submission_token, uploads, status: action === "draft" ? "draft" : "pending" });
  } catch (error) {
    console.error("Showcase submit error", error);
    return NextResponse.json({ error: "Something went wrong while saving your post." }, { status: 500 });
  }
}
