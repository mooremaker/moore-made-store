import { NextResponse } from "next/server";
import type {
  MockupAssetBucket,
  MockupDocument,
  MockupLayer,
  MockupView,
} from "@/lib/mockup-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const ALLOWED_ASSET_BUCKETS = new Set<MockupAssetBucket>(["custom-request-files", "mockup-studio-files"]);

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function finite(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function sanitizeCustomerMockupDocument(value: unknown, requestId: string, allowedPaths: string[]): MockupDocument | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const rawViews = Array.isArray(raw.views) ? raw.views.slice(0, 6) : [];
  if (!rawViews.length) return null;
  const pathSet = new Set(allowedPaths);

  const views: MockupView[] = rawViews.map((rawView, viewIndex) => {
    const view = (rawView || {}) as Record<string, unknown>;
    const id = text(view.id, 100) || `view-${viewIndex + 1}`;
    const rawLayers = Array.isArray(view.layers) ? view.layers.slice(0, 12) : [];
    const layers = rawLayers.map((rawLayer, layerIndex) => {
      const layer = (rawLayer || {}) as Record<string, unknown>;
      const rawAsset = layer.asset && typeof layer.asset === "object" ? layer.asset as Record<string, unknown> : {};
      const path = text(rawAsset.path, 1000);
      const bucket = text(rawAsset.bucket, 80) as MockupAssetBucket;
      if (!path || !pathSet.has(path) || !path.startsWith(`${requestId}/`) || !ALLOWED_ASSET_BUCKETS.has(bucket)) return null;
      return {
        id: text(layer.id, 100) || `${id}-layer-${layerIndex + 1}`,
        asset: {
          path,
          originalName: text(rawAsset.originalName, 300) || path.split("/").pop() || "Customer artwork",
          bucket,
        },
        x: finite(layer.x, 50, -30, 130),
        y: finite(layer.y, 50, -30, 130),
        width: finite(layer.width, 30, 2, 120),
        rotation: finite(layer.rotation, 0, -360, 360),
        opacity: finite(layer.opacity, 1, 0.05, 1),
        zIndex: Math.max(0, Math.floor(finite(layer.zIndex, layerIndex + 1, 0, 100))),
      } satisfies MockupLayer;
    }).filter(Boolean) as MockupLayer[];

    const rawIntent = view.customerIntent && typeof view.customerIntent === "object" ? view.customerIntent as Record<string, unknown> : {};
    const rawSource = text(rawIntent.source, 30);
    const source = rawSource === "upload" || rawSource === "idea" ? rawSource : "example";
    const rawTemplate = view.template && typeof view.template === "object" ? view.template as Record<string, unknown> : {};

    return {
      id,
      name: text(view.name, 100) || `View ${viewIndex + 1}`,
      base: null,
      layers,
      customerIntent: {
        enabled: Boolean(rawIntent.enabled),
        source,
        placement: text(rawIntent.placement, 100) || "custom",
        placementLabel: text(rawIntent.placementLabel, 160) || undefined,
        idea: source === "idea" ? text(rawIntent.idea, 3000) || undefined : undefined,
        artworkFileName: source === "upload" ? text(rawIntent.artworkFileName, 300) || undefined : undefined,
        x: finite(rawIntent.x, 50, -30, 130),
        y: finite(rawIntent.y, 50, -30, 130),
        width: finite(rawIntent.width, 30, 2, 120),
        rotation: finite(rawIntent.rotation, 0, -360, 360),
      },
      template: {
        productSlug: text(rawTemplate.productSlug, 160) || undefined,
        productName: text(rawTemplate.productName, 300) || undefined,
        previewKind: text(rawTemplate.previewKind, 80) || undefined,
        colorName: text(rawTemplate.colorName, 120) || undefined,
        colorValue: text(rawTemplate.colorValue, 40) || undefined,
        viewKey: text(rawTemplate.viewKey, 80) || undefined,
      },
    };
  });

  return {
    version: 1,
    source: "customer",
    productSlug: text(raw.productSlug, 160) || null,
    productName: text(raw.productName, 300) || null,
    colorName: text(raw.colorName, 120) || null,
    previewKind: text(raw.previewKind, 80) || null,
    activeViewId: text(raw.activeViewId, 100) || views.find((view) => view.customerIntent?.enabled)?.id || views[0]?.id || null,
    views,
  };
}

function mockupTableMissing(error: { message?: string; code?: string } | null | undefined) {
  const message = (error?.message || "").toLowerCase();
  return message.includes("mockup_projects") || error?.code === "42P01" || error?.code === "PGRST205";
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const submissionToken = typeof body.submissionToken === "string" ? body.submissionToken : "";
    const paths = Array.isArray(body.paths)
      ? body.paths.filter((path: unknown): path is string => typeof path === "string" && path.startsWith(`${id}/`)).slice(0, 8)
      : [];

    if (!id || !submissionToken) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: order, error: orderError } = await supabase
      .from("custom_requests")
      .select("id,request_number,product,customer_user_id")
      .eq("id", id)
      .eq("submission_token", submissionToken)
      .maybeSingle();

    if (orderError || !order) {
      return NextResponse.json({ error: "Invalid or expired request link." }, { status: 403 });
    }

    const { error: updateError } = await supabase
      .from("custom_requests")
      .update({ artwork_paths: paths })
      .eq("id", id)
      .eq("submission_token", submissionToken);

    if (updateError) {
      console.error("Artwork path update failed", updateError);
      return NextResponse.json({ error: "Could not attach artwork files." }, { status: 500 });
    }

    let mockupWarning = false;
    const document = sanitizeCustomerMockupDocument(body.mockupDocument, id, paths);
    if (document) {
      const title = `MM-${String(order.request_number).padStart(6, "0")} · ${order.product}`;
      const { data: existing, error: existingError } = await supabase
        .from("mockup_projects")
        .select("id,status,created_by")
        .eq("request_id", id)
        .neq("status", "archived")
        .maybeSingle();

      if (existingError && mockupTableMissing(existingError)) {
        mockupWarning = true;
      } else if (existingError) {
        console.error("Customer mockup lookup failed", existingError);
        mockupWarning = true;
      } else if (existing?.id && (existing.status !== "draft" || existing.created_by)) {
        // Never let the original customer submission overwrite later admin work.
        mockupWarning = true;
      } else {
        const payload = {
          request_id: id,
          customer_user_id: order.customer_user_id || null,
          title,
          status: "draft",
          document,
          created_by: null,
        };
        const query = existing?.id
          ? supabase.from("mockup_projects").update({ title, document, status: "draft" }).eq("id", existing.id).is("created_by", null)
          : supabase.from("mockup_projects").insert(payload);
        const { error: saveError } = await query;
        if (saveError) {
          console.error("Customer mockup save failed", saveError);
          mockupWarning = true;
        }
      }
    }

    return NextResponse.json({ ok: true, mockupWarning });
  } catch (error) {
    console.error("Artwork completion route error", error);
    return NextResponse.json({ error: "Could not attach artwork files." }, { status: 500 });
  }
}
