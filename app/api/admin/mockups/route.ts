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
  type MockupVectorLayer,
  type MockupView,
} from "@/lib/mockup-types";
import {
  expandMockupVariants,
  reconnectCustomerArtwork,
} from "@/lib/mockup-variants";
import {
  getSupabaseAdmin,
  MOCKUP_STUDIO_BUCKET,
  QUOTE_PROOF_BUCKET,
} from "@/lib/supabase-admin";
import { isDesignDocumentV2 } from "@/lib/design-engine/types";

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

function optionalFinite(value: unknown, min: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

function safeColor(value: unknown, fallback = "#171717") {
  const color = text(value, 24);
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function vectorLayer(
  value: unknown,
  fallbackId: string,
  zIndex: number,
): MockupVectorLayer | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const kind = row.kind === "text" || row.kind === "drawing" ? row.kind : null;
  if (!kind) return null;
  const base = {
    id: text(row.id, 100) || fallbackId,
    kind,
    name:
      text(row.name, 100) ||
      (kind === "text" ? "Customer text" : "Customer drawing"),
    x: finite(row.x, 50, -100, 200),
    y: finite(row.y, 50, -100, 200),
    width: finite(row.width, 30, 1, 300),
    height: finite(row.height, 14, 1, 300),
    rotation: finite(row.rotation, 0, -360, 360),
    opacity: finite(row.opacity, 1, 0.05, 1),
    zIndex: Math.max(0, Math.floor(finite(row.zIndex, zIndex, 0, 1000))),
  };
  if (kind === "text") {
    const weight = Number(row.fontWeight);
    return {
      ...base,
      kind,
      text: text(row.text, 500),
      fontFamily: text(row.fontFamily, 180) || "Arial, sans-serif",
      fontLabel: text(row.fontLabel, 80) || "Arial",
      fontWeight: weight === 400 || weight === 900 ? weight : 700,
      color: safeColor(row.color),
      textAlign:
        row.textAlign === "left" || row.textAlign === "right"
          ? row.textAlign
          : "center",
      letterSpacingEm: finite(row.letterSpacingEm, 0, -0.1, 0.5),
      fontSizePt: finite(row.fontSizePt, 36, 4, 1000),
    };
  }
  const strokes = Array.isArray(row.strokes)
    ? row.strokes
        .slice(0, 250)
        .map((rawStroke) => {
          const stroke = (rawStroke || {}) as Record<string, unknown>;
          const points = Array.isArray(stroke.points)
            ? stroke.points.slice(0, 2500).map((rawPoint) => {
                const point = (rawPoint || {}) as Record<string, unknown>;
                return {
                  x: finite(point.x, 0, 0, 1000),
                  y: finite(point.y, 0, 0, 600),
                };
              })
            : [];
          return {
            color: safeColor(stroke.color),
            width: finite(stroke.width, 10, 1, 60),
            tool: (stroke.tool === "marker" || stroke.tool === "eraser"
              ? stroke.tool
              : "pen") as "pen" | "marker" | "eraser",
            opacity: finite(stroke.opacity, 1, 0.05, 1),
            points,
          };
        })
        .filter((stroke) => stroke.points.length > 1)
    : [];
  return { ...base, kind, strokes };
}

function asset(value: unknown): MockupAssetRef | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const path = text(row.path, 1000);
  if (!path) return null;
  const bucketText = text(row.bucket, 80) as MockupAssetBucket;
  return {
    path,
    originalName:
      text(row.originalName, 300) || path.split("/").pop() || "Image",
    ...(ALLOWED_ASSET_BUCKETS.has(bucketText) ? { bucket: bucketText } : {}),
  };
}

function customerIntent(value: unknown): MockupCustomerIntent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const rawSource = text(row.source, 30);
  const source: MockupCustomerIntent["source"] =
    rawSource === "upload" ||
    rawSource === "idea" ||
    rawSource === "text" ||
    rawSource === "drawing" ||
    rawSource === "mixed"
      ? rawSource
      : "example";
  return {
    enabled: Boolean(row.enabled),
    source,
    placement: text(row.placement, 100) || "custom",
    placementLabel: text(row.placementLabel, 160) || undefined,
    idea: text(row.idea, 3000) || undefined,
    artworkFileName: text(row.artworkFileName, 300) || undefined,
    details: text(row.details, 2000) || undefined,
    backgroundRemovalRequested: Boolean(row.backgroundRemovalRequested),
    x: finite(row.x, 50, -100, 200),
    y: finite(row.y, 50, -100, 200),
    width: finite(row.width, 30, 1, 300),
    height: optionalFinite(row.height, 1, 300),
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
    designGroupId: text(row.designGroupId, 180) || undefined,
    orderItemId: text(row.orderItemId, 180) || undefined,
    quantity:
      Math.max(0, Math.floor(finite(row.quantity, 0, 0, 1000000))) || undefined,
    designRelationship:
      row.designRelationship === "primary" ||
      row.designRelationship === "separate"
        ? row.designRelationship
        : row.designRelationship === "same"
          ? "same"
          : undefined,
    orderItemNotes: text(row.orderItemNotes, 2000) || undefined,
  };
  return Object.values(result).some(Boolean) ? result : null;
}

function normalizeDocument(value: unknown): MockupDocument {
  if (!value || typeof value !== "object") return emptyMockupDocument();
  const doc = value as Record<string, unknown>;
  const rawViews = Array.isArray(doc.views) ? doc.views.slice(0, 120) : [];
  const views: MockupView[] = rawViews.map((raw, viewIndex) => {
    const view = (raw || {}) as Record<string, unknown>;
    const id = text(view.id, 100) || `view-${viewIndex + 1}`;
    const layers = Array.isArray(view.layers)
      ? (view.layers
          .slice(0, 100)
          .map((rawLayer, layerIndex) => {
            const layer = (rawLayer || {}) as Record<string, unknown>;
            const layerAsset = asset(layer.asset);
            if (!layerAsset) return null;
            return {
              id: text(layer.id, 100) || `${id}-layer-${layerIndex + 1}`,
              asset: layerAsset,
              x: finite(layer.x, 50, -100, 200),
              y: finite(layer.y, 50, -100, 200),
              width: finite(layer.width, 30, 1, 300),
              height: optionalFinite(layer.height, 1, 300),
              rotation: finite(layer.rotation, 0, -360, 360),
              opacity: finite(layer.opacity, 1, 0.05, 1),
              zIndex: Math.max(
                0,
                Math.floor(finite(layer.zIndex, layerIndex + 1, 0, 1000)),
              ),
              locked: Boolean(layer.locked),
            } satisfies MockupLayer;
          })
          .filter(Boolean) as MockupLayer[])
      : [];
    const vectorLayers = Array.isArray(view.vectorLayers)
      ? (view.vectorLayers
          .slice(0, 100)
          .map((rawLayer, layerIndex) =>
            vectorLayer(
              rawLayer,
              `${id}-vector-${layerIndex + 1}`,
              layers.length + layerIndex + 1,
            ),
          )
          .filter(Boolean) as MockupVectorLayer[])
      : [];
    return {
      id,
      name: text(view.name, 100) || `View ${viewIndex + 1}`,
      base: asset(view.base),
      layers,
      vectorLayers,
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
    designEngine: isDesignDocumentV2(doc.designEngine)
      ? structuredClone(doc.designEngine)
      : undefined,
    designDocuments: Array.isArray(doc.designDocuments)
      ? doc.designDocuments
          .filter(isDesignDocumentV2)
          .slice(0, 40)
          .map((item) => structuredClone(item))
      : undefined,
    views: safeViews,
    activeViewId: text(doc.activeViewId, 100) || safeViews[0]?.id || null,
  };
}

async function signedDocument(document: MockupDocument) {
  const supabase = getSupabaseAdmin();
  const sign = async (
    ref: MockupAssetRef | null | undefined,
    fallbackBucket: string,
  ) => {
    if (!ref?.path) return ref || null;
    const bucket = ref.bucket || fallbackBucket;
    const { data } = await supabase.storage
      .from(bucket)
      .createSignedUrl(ref.path, 3600);
    return { ...ref, url: data?.signedUrl || null };
  };
  return {
    ...document,
    views: await Promise.all(
      document.views.map(async (view) => ({
        ...view,
        base: await sign(view.base, MOCKUP_STUDIO_BUCKET),
        layers: await Promise.all(
          view.layers.map(async (layer) => ({
            ...layer,
            asset: (await sign(layer.asset, MOCKUP_STUDIO_BUCKET))!,
          })),
        ),
        exportAsset: await sign(view.exportAsset, QUOTE_PROOF_BUCKET),
      })),
    ),
  } satisfies MockupDocument;
}

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  const requestId = new URL(request.url).searchParams.get("requestId") || "";
  if (!requestId)
    return NextResponse.json({ error: "Order is required." }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const [{ data: project, error }, { data: order }] = await Promise.all([
    supabase
      .from("mockup_projects")
      .select(
        "id,request_id,customer_user_id,title,status,document,created_by,created_at,updated_at",
      )
      .eq("request_id", requestId)
      .neq("status", "archived")
      .maybeSingle(),
    supabase
      .from("custom_requests")
      .select("id,product,order_items,artwork_paths")
      .eq("id", requestId)
      .maybeSingle(),
  ]);
  if (error && error.code !== "PGRST116") {
    if ((error.message || "").toLowerCase().includes("mockup_projects"))
      return NextResponse.json(
        {
          error: "Mockup Studio needs its Supabase migration.",
          code: "MIGRATION_REQUIRED",
        },
        { status: 503 },
      );
    console.error("Mockup project load failed", error);
    return NextResponse.json(
      { error: "Could not load the mockup project." },
      { status: 500 },
    );
  }
  let recoveredArtworkPaths = Array.isArray(order?.artwork_paths)
    ? order.artwork_paths.filter((path): path is string => typeof path === "string" && Boolean(path))
    : [];
  // Older submissions can finish the Storage upload but lose the final
  // artwork_paths update. Recover only files inside this order's own folder,
  // then persist the verified paths so the order, admin preview, and quote all
  // use the same source of truth from now on.
  if (order?.id && recoveredArtworkPaths.length === 0) {
    const { data: storedFiles, error: storageError } = await supabase.storage
      .from("custom-request-files")
      .list(order.id, { limit: 25 });
    const recovered = !storageError
      ? (storedFiles || [])
          .filter((file) => Boolean(file.name) && file.id)
          .map((file) => `${order.id}/${file.name}`)
      : [];
    if (recovered.length) {
      recoveredArtworkPaths = recovered;
      const { error: repairError } = await supabase
        .from("custom_requests")
        .update({ artwork_paths: recovered })
        .eq("id", order.id);
      if (repairError) console.error("Recovered artwork path update failed", repairError);
    }

    // Very early uploads used a transient folder identifier instead of the
    // final order id. For an otherwise empty order, look only for a *single*
    // uniquely matching product file in another top-level upload folder. This
    // is deliberately conservative: common product names are never guessed.
    if (!recoveredArtworkPaths.length) {
      const productWords = String(order.product || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 6);
      if (productWords.length) {
        const { data: rootEntries, error: rootError } = await supabase.storage
          .from("custom-request-files")
          .list("", { limit: 100 });
        if (!rootError) {
          const folders = (rootEntries || []).filter((entry) => !entry.id && entry.name);
          const childLists = await Promise.all(folders.map(async (folder) => {
            const { data } = await supabase.storage.from("custom-request-files").list(folder.name, { limit: 25 });
            return (data || []).filter((file) => Boolean(file.id)).map((file) => `${folder.name}/${file.name}`);
          }));
          const candidates = childLists.flat().filter((path) => {
            const fileName = path.split("/").pop()?.toLowerCase() || "";
            return productWords.some((word) => fileName.includes(word));
          });
          if (candidates.length === 1) {
            recoveredArtworkPaths = candidates;
            const { error: repairError } = await supabase
              .from("custom_requests")
              .update({ artwork_paths: candidates })
              .eq("id", order.id);
            if (repairError) console.error("Legacy artwork path update failed", repairError);
          }
        }
      }
    }
  }

  const normalizedDocument = normalizeDocument(
    project?.document || emptyMockupDocument(),
  );
  const repairedDocument = reconnectCustomerArtwork(
    normalizedDocument,
    recoveredArtworkPaths,
  );
  const rawDocument = expandMockupVariants(
    repairedDocument,
    order?.order_items,
  );
  const document = await signedDocument(rawDocument);
  if (project?.id && recoveredArtworkPaths.length && JSON.stringify(rawDocument) !== JSON.stringify(normalizedDocument)) {
    const { error: projectRepairError } = await supabase
      .from("mockup_projects")
      .update({ document: rawDocument })
      .eq("id", project.id)
      .is("created_by", null);
    if (projectRepairError) console.error("Recovered mockup document update failed", projectRepairError);
  }
  const proofExports = document.views
    .filter((view) => view.exportAsset?.path)
    .map((view) => ({
      viewId: view.id,
      title: view.name,
      path: view.exportAsset!.path,
      originalName: view.exportAsset!.originalName,
      url: view.exportAsset!.url || null,
    }));
  return NextResponse.json({
    ok: true,
    project: project ? { ...project, document } : null,
    document,
    proofExports,
  });
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok)
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const requestId = text(body.requestId, 100);
    if (!requestId)
      return NextResponse.json(
        { error: "Order is required." },
        { status: 400 },
      );
    const normalizedDocument = normalizeDocument(body.document);
    const title = text(body.title, 300) || "Order mockup";
    const status = body.status === "proof_ready" ? "proof_ready" : "draft";
    const supabase = getSupabaseAdmin();
    const { data: order } = await supabase
      .from("custom_requests")
      .select("id,customer_user_id,order_items,artwork_paths")
      .eq("id", requestId)
      .single();
    if (!order)
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    const document = expandMockupVariants(
      reconnectCustomerArtwork(normalizedDocument, order.artwork_paths),
      order.order_items,
    );
    const payload = {
      request_id: requestId,
      customer_user_id: order.customer_user_id || null,
      title,
      status,
      document,
      created_by: auth.user.id,
    };
    const { data: existing } = await supabase
      .from("mockup_projects")
      .select("id")
      .eq("request_id", requestId)
      .neq("status", "archived")
      .maybeSingle();
    const query = existing?.id
      ? supabase
          .from("mockup_projects")
          .update({ title, status, document })
          .eq("id", existing.id)
      : supabase.from("mockup_projects").insert(payload);
    const { data: project, error } = await query
      .select(
        "id,request_id,customer_user_id,title,status,document,created_by,created_at,updated_at",
      )
      .single();
    if (error || !project) {
      console.error("Mockup project save failed", error);
      return NextResponse.json(
        {
          error: (error?.message || "")
            .toLowerCase()
            .includes("mockup_projects")
            ? "Mockup Studio needs its Supabase migration."
            : "Could not save the mockup project.",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      project,
      message:
        status === "proof_ready"
          ? "Mockups saved and marked proof-ready."
          : "Mockup project saved.",
    });
  } catch (error) {
    console.error("Mockup project route failed", error);
    return NextResponse.json(
      { error: "Could not save the mockup project." },
      { status: 500 },
    );
  }
}
