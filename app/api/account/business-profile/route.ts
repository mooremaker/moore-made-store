import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const BUCKET = "customer-brand-assets";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_LOGOS = 10;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeFileName(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 120) || "logo";
}

function colors(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((color) => text(color, 7).toUpperCase()).filter((color) => /^#[0-9A-F]{6}$/.test(color)))).slice(0, 8);
}

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const body = await request.json();
    const payload = {
      customer_user_id: user.id,
      business_name: text(body.businessName, 180) || null,
      website: text(body.website, 300) || null,
      brand_colors: colors(body.brandColors),
      brand_notes: text(body.brandNotes, 3000) || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await getSupabaseAdmin().from("customer_business_profiles").upsert(payload, { onConflict: "customer_user_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true, profile: payload });
  } catch (error) {
    console.error("Business profile save failed", error);
    return NextResponse.json({ error: "Could not save the business profile. Make sure the latest Supabase patch has been run." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const body = await request.json();
    const action = text(body.action, 40);
    const admin = getSupabaseAdmin();

    if (action === "prepare_logo") {
      const { count } = await admin.from("client_brand_assets").select("id", { count: "exact", head: true }).eq("customer_user_id", user.id);
      if ((count || 0) >= MAX_LOGOS) return NextResponse.json({ error: `You can save up to ${MAX_LOGOS} logos.` }, { status: 400 });
      const size = Number(body.size) || 0;
      const type = text(body.type, 160);
      if (size < 1 || size > MAX_FILE_BYTES) return NextResponse.json({ error: "Logo files must be 20 MB or smaller." }, { status: 400 });
      if (!(type.startsWith("image/") || /pdf|svg/i.test(type))) return NextResponse.json({ error: "Upload a PNG, JPG, SVG, or PDF logo." }, { status: 400 });
      const originalName = text(body.name, 300) || "logo";
      const path = `${user.id}/${crypto.randomUUID()}-${safeFileName(originalName)}`;
      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data?.token) throw error || new Error("Could not prepare logo upload.");
      return NextResponse.json({ target: { path, token: data.token }, originalName });
    }

    if (action === "finish_logo") {
      const path = text(body.path, 1000);
      if (!path.startsWith(`${user.id}/`)) return NextResponse.json({ error: "Invalid logo upload." }, { status: 400 });
      const label = text(body.label, 180) || text(body.originalName, 300) || "Business logo";
      const { data, error } = await admin.from("client_brand_assets").insert({
        customer_user_id: user.id,
        label,
        storage_bucket: BUCKET,
        storage_path: path,
        original_filename: text(body.originalName, 300) || null,
        asset_kind: "logo",
        production_approved: false,
        created_by: user.id,
      }).select("id,label,storage_bucket,storage_path,original_filename,asset_kind,production_approved,created_at,updated_at").single();
      if (error) throw error;
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
      return NextResponse.json({ asset: { ...data, url: signed?.signedUrl || null } });
    }

    return NextResponse.json({ error: "Unsupported business-profile action." }, { status: 400 });
  } catch (error) {
    console.error("Business logo write failed", error);
    return NextResponse.json({ error: "Could not save this logo. Make sure the latest Supabase patch has been run." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const body = await request.json();
    const assetId = text(body.assetId, 80);
    const admin = getSupabaseAdmin();
    const { data: asset } = await admin.from("client_brand_assets").select("id,storage_bucket,storage_path").eq("id", assetId).eq("customer_user_id", user.id).maybeSingle();
    if (!asset) return NextResponse.json({ ok: true });
    await admin.storage.from(asset.storage_bucket || BUCKET).remove([asset.storage_path]);
    const { error } = await admin.from("client_brand_assets").delete().eq("id", assetId).eq("customer_user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Business logo delete failed", error);
    return NextResponse.json({ error: "Could not delete this logo." }, { status: 500 });
  }
}
