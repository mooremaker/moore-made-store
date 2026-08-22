import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import {
  emptyMockupDocument,
  type MockupAssetBucket,
  type MockupAssetRef,
  type MockupCustomerIntent,
  type MockupDocument,
  type MockupLayer,
  type MockupTemplateRef,
  type MockupView,
} from "@/lib/mockup-types";
import { getSupabaseAdmin, MOCKUP_STUDIO_BUCKET, QUOTE_PROOF_BUCKET } from "@/lib/supabase-admin";

const ALLOWED_ASSET_BUCKETS = new Set<MockupAssetBucket>([
  "mockup-studio-files",
  "custom-request-files",
  "quote-proof-files",
]);

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function finite(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function asset(value: unknown): MockupAssetRef | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const path = text(row.path, 1000);
  if (!path) return null;
  const bucketText = text(row.bucket, 80) as MockupAssetBucket;
  return {
    path,
    originalName: text(row.originalName, 300) || path.split("/").pop() || "Image",
    ...(ALLOWED_ASSET_BUCKETS.has(bucketText) ? { bucket: bucketText } : {}),
  };
}

function customerIntent(value: unknown): MockupCustomerIntent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const rawSource = text(row.source, 30);
  const source: MockupCustomerIntent["source"] = rawSource === "upload" || rawSource === "idea" ? rawSource : "example";
  return {
    enabled: Boolean(row.enabled),
    source,
    placement: text(row.placement, 100) || "custom",
    placementLabel: text(row.placementLabel, 160) || undefined,
    idea: text(row.idea, 3000) || undefined,
    artworkFileName: text(row.artworkFileName, 300) || undefined,
    x: finite(row.x, 50, -100, 200),
    y: finite(row.y, 50, -100, 200),
    width: finite(row.width, 30, 1, 300),
    rotation: finite(row.rotation, 0, -360, 360),
  };
}

function templateRef(value: unknown): MockupTemplateRef | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const result: MockupTemplateRef = {
    productSlug: text(row.productSlug, 160) || undefined,
    productName: text(row.productName, 300) || undefined,
    previewKind: text(row.previewKind, 80) || undefined,
    colorName: text(row.colorName, 120) || undefined,
    colorValue: text(row.colorValue, 40) || undefined,
    viewKey: text(row.viewKey, 80) || undefined,
  };
  return Object.values(result).some(Boolean) ? result : null;
}

function normalizeDocument(value: unknown): MockupDocument {
  if (!value || typeof value !== "object") return emptyMockupDocument();
  const doc = value as Record<string, unknown>;
  const rawViews = Array.isArray(doc.views) ? doc.views.slice(0, 12) : [];
  const views: MockupView[] = rawViews.map((raw, viewIndex) => {
    const view = (raw || {}) as Record<string, unknown>;
    const id = text(view.id, 100) || `view-${viewIndex + 1}`;
    const layers = Array.isArray(view.layers)
      ? view.layers.slice(0, 100).map((rawLayer, layerIndex) => {
          const layer = (rawLayer || {}) as Record<string, unknown>;
          const layerAsset = asset(layer.asset);
          if (!layerAsset) return null;
          return {
            id: text(layer.id, 100) || `${id}-layer-${layerIndex + 1}`,
            asset: layerAsset,
            x: finite(layer.x, 50, -100, 200),
            y: finite(layer.y, 50, -100, 200),
            width: finite(layer.width, 30, 1, 300),
            rotation: finite(layer.rotation, 0, -360, 360),
            opacity: finite(layer.opacity, 1, 0.05, 1),
            zIndex: Math.max(0, Math.floor(finite(layer.zIndex, layerIndex + 1, 0, 1000))),
            locked: Boolean(layer.locked),
          } satisfies MockupLayer;
        }).filter(Boolean) as MockupLayer[]
      : [];
    return {
      id,
      name: text(view.name, 100) || `View ${viewIndex + 1}`,
      base: asset(view.base),
      layers,
      exportAsset: asset(view.exportAsset),
      customerIntent: customerIntent(view.customerIntent),
      template: templateRef(view.template),
    };
  });
  const safeViews = views.length ? views : emptyMockupDocument().views;
  const source = text(doc.source, 30) === "customer" ? "customer" : "admin";
  return {
    version: 1,
    source,
    productSlug: text(doc.productSlug, 160) || null,
    productName: text(doc.productName, 300) || null,
    colorName: text(doc.colorName, 120) || null,
    previewKind: text(doc.previewKind, 80) || null,
    views: safeViews,
    activeViewId: text(doc.activeViewId, 100) || safeViews[0]?.id || null,
  };
}

async function signedDocument(document: MockupDocument) {
  const supabase = getSupabaseAdmin();
  const sign = async (ref: MockupAssetRef | null | undefined, fallbackBucket: string) => {
    if (!ref?.path) return ref || null;
    const bucket = ref.bucket || fallbackBucket;
    const { data } = await supabase.storage.from(bucket).createSignedUrl(ref.path, 3600);
    return { ...ref, url: data?.signedUrl || null };
  };
  return {
    ...document,
    views: await Promise.all(document.views.map(async (view) => ({
      ...view,
      base: await sign(view.base, MOCKUP_STUDIO_BUCKET),
      layers: await Promise.all(view.layers.map(async (layer) => ({ ...layer, asset: (await sign(layer.asset, MOCKUP_STUDIO_BUCKET))! }))),
      exportAsset: await sign(view.exportAsset, QUOTE_PROOF_BUCKET),
    }))),
  } satisfies MockupDocument;
}

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const requestId = new URL(request.url).searchParams.get("requestId") || "";
  if (!requestId) return NextResponse.json({ error: "Order is required." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data: project, error } = await supabase.from("mockup_projects").select("id,request_id,customer_user_id,title,status,document,created_by,created_at,updated_at").eq("request_id", requestId).neq("status", "archived").maybeSingle();
  if (error && error.code !== "PGRST116") {
    if ((error.message || "").toLowerCase().includes("mockup_projects")) return NextResponse.json({ error: "Mockup Studio needs its Supabase migration.", code: "MIGRATION_REQUIRED" }, { status: 503 });
    console.error("Mockup project load failed", error);
    return NextResponse.json({ error: "Could not load the mockup project." }, { status: 500 });
  }
  const rawDocument = normalizeDocument(project?.document || emptyMockupDocument());
  const document = await signedDocument(rawDocument);
  const proofExports = document.views.filter((view) => view.exportAsset?.path).map((view) => ({ viewId: view.id, title: view.name, path: view.exportAsset!.path, originalName: view.exportAsset!.originalName, url: view.exportAsset!.url || null }));
  return NextResponse.json({ ok: true, project: project ? { ...project, document } : null, document, proofExports });
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const requestId = text(body.requestId, 100);
    if (!requestId) return NextResponse.json({ error: "Order is required." }, { status: 400 });
    const document = normalizeDocument(body.document);
    const title = text(body.title, 300) || "Order mockup";
    const status = body.status === "proof_ready" ? "proof_ready" : "draft";
    const supabase = getSupabaseAdmin();
    const { data: order } = await supabase.from("custom_requests").select("id,customer_user_id").eq("id", requestId).single();
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    const payload = { request_id: requestId, customer_user_id: order.customer_user_id || null, title, status, document, created_by: auth.user.id };
    const { data: existing } = await supabase.from("mockup_projects").select("id").eq("request_id", requestId).neq("status", "archived").maybeSingle();
    const query = existing?.id ? supabase.from("mockup_projects").update({ title, status, document }).eq("id", existing.id) : supabase.from("mockup_projects").insert(payload);
    const { data: project, error } = await query.select("id,request_id,customer_user_id,title,status,document,created_by,created_at,updated_at").single();
    if (error || !project) {
      console.error("Mockup project save failed", error);
      return NextResponse.json({ error: (error?.message || "").toLowerCase().includes("mockup_projects") ? "Mockup Studio needs its Supabase migration." : "Could not save the mockup project." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, project, message: status === "proof_ready" ? "Mockups saved and marked proof-ready." : "Mockup project saved." });
  } catch (error) {
    console.error("Mockup project route failed", error);
    return NextResponse.json({ error: "Could not save the mockup project." }, { status: 500 });
  }
}
