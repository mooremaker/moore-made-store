import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getProduct, products, type ProductPreviewKind } from "@/lib/catalog";
import { signMockupDocumentForDisplay } from "@/lib/mockup-display-server";
import type { MockupDocument, MockupView } from "@/lib/mockup-types";
import type { StructuredOrderItem } from "@/lib/order-types";
import { CUSTOM_REQUEST_BUCKET, getSupabaseAdmin } from "@/lib/supabase-admin";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function viewKey(view: MockupView, index: number): "front" | "back" {
  if (view.template?.viewKey === "back") return "back";
  if (view.template?.viewKey === "front") return "front";
  return /back/i.test(view.name || view.id) || index === 1 ? "back" : "front";
}

function groupKey(view: MockupView, document: MockupDocument) {
  if (document.source !== "customer") return "order";
  return view.id.replace(/-(front|back)$/i, "") || "order";
}

function validOrderItems(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is StructuredOrderItem => Boolean(item && typeof item === "object")) : [];
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const body = await request.json();
    const requestId = text(body.requestId, 80);
    const admin = getSupabaseAdmin();
    const { data: order, error } = await admin.from("custom_requests")
      .select("id,request_number,product,order_items,print_sides,artwork_paths")
      .eq("id", requestId)
      .eq("customer_user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

    const { data: project } = await admin.from("mockup_projects").select("document").eq("request_id", requestId).neq("status", "archived").maybeSingle();
    const signedDocument = project?.document ? await signMockupDocumentForDisplay(project.document, 15 * 60) : null;
    const orderItems = validOrderItems(order.order_items);
    const fallbackArtwork = text(Array.isArray(order.artwork_paths) ? order.artwork_paths[0] : "", 1000);
    let fallbackArtworkUrl = "";
    if (fallbackArtwork) {
      const { data: signed } = await admin.storage.from(CUSTOM_REQUEST_BUCKET).createSignedUrl(fallbackArtwork, 15 * 60);
      fallbackArtworkUrl = signed?.signedUrl || "";
    }

    const document: MockupDocument = signedDocument || {
      version: 1,
      source: "customer",
      productName: order.product,
      views: [{ id: "order-front", name: "Front", base: null, layers: [], customerIntent: { enabled: true, source: fallbackArtworkUrl ? "upload" : "idea", placement: "custom", idea: fallbackArtworkUrl ? "" : `Recreate the design from order #${order.request_number}.`, x: 50, y: 48, width: 36, height: 24, rotation: 0 }, template: { productSlug: orderItems[0]?.productSlug, productName: orderItems[0]?.productName || order.product, viewKey: "front" } }],
    };
    const groups = new Map<string, MockupView[]>();
    document.views.forEach((view) => groups.set(groupKey(view, document), [...(groups.get(groupKey(view, document)) || []), view]));
    if (!groups.size) return NextResponse.json({ error: "This order does not have enough design information to reorder automatically. Message Moore Made and we can rebuild it for you." }, { status: 400 });

    const items = Array.from(groups.entries()).map(([key, views], groupIndex) => {
      let matchingRows = key === "order" ? orderItems : orderItems.filter((row) => String(row.id || "").startsWith(`${key}-`));
      if (!matchingRows.length && groupIndex === 0) matchingRows = orderItems;
      const firstView = views[0];
      const firstRow = matchingRows[0];
      const product = getProduct(firstView.template?.productSlug || firstRow?.productSlug || "") || getProduct(firstRow?.productSlug || "") || products.find((row) => row.name === order.product) || products[0];
      const normalizedRows = matchingRows.length ? matchingRows.map((row, rowIndex) => ({ ...row, id: randomUUID(), productSlug: row.productSlug || product.slug, productName: row.productName || product.name, designRelationship: rowIndex === 0 ? "primary" as const : row.designRelationship || "same" as const })) : [{ id: randomUUID(), productSlug: product.slug, productName: product.name, colorName: firstView.template?.colorName || product.colors[0]?.name || "Default", quantities: Object.fromEntries(product.sizes.map((size, index) => [size, index === 0 ? 1 : 0])), designRelationship: "primary" as const }];
      const byView = new Map(views.map((view, index) => [viewKey(view, index), view]));
      const enabledKeys: Array<"front" | "back"> = product.supportsBack ? ["front", "back"] : ["front"];
      const preparedViews = enabledKeys.map((side) => {
        const source = byView.get(side);
        const layer = source?.layers?.find((candidate) => candidate.asset?.url) || null;
        const intent = source?.customerIntent;
        const download = layer?.asset?.url ? { url: layer.asset.url, name: layer.asset.originalName || "Reorder artwork" } : !layer && fallbackArtworkUrl && side === "front" ? { url: fallbackArtworkUrl, name: fallbackArtwork.split("/").pop() || "Reorder artwork" } : null;
        return {
          view: side,
          enabled: Boolean(source) || (side === "front" && (!source || Boolean(download))),
          mode: download ? "upload" as const : "idea" as const,
          placement: intent?.placement || "custom",
          placementLabel: intent?.placementLabel || "Customer placement",
          idea: download ? "" : intent?.idea || `Recreate the ${side} design from order #${order.request_number}.`,
          details: intent?.details || `Reorder based on order #${order.request_number}.`,
          download,
          x: Number(layer?.x ?? intent?.x ?? 50),
          y: Number(layer?.y ?? intent?.y ?? 48),
          width: Number(layer?.width ?? intent?.width ?? 36),
          height: Number(layer?.height ?? intent?.height ?? 24),
          rotation: Number(layer?.rotation ?? intent?.rotation ?? 0),
        };
      });
      const activeSides = preparedViews.filter((view) => view.enabled).map((view) => view.view);
      const coverageLabel = activeSides.includes("front") && activeSides.includes("back") ? `${product.viewLabels.front} + ${product.viewLabels.back}` : activeSides[0] === "back" ? `${product.viewLabels.back} only` : `${product.viewLabels.front} only`;
      return {
        productSlug: product.slug,
        productName: product.name,
        previewKind: product.previewKind as ProductPreviewKind,
        viewLabels: product.viewLabels,
        coverageLabel,
        colorName: normalizedRows[0]?.colorName || firstView.template?.colorName || product.colors[0]?.name || "Default",
        customItemType: normalizedRows[0]?.customItemType || "",
        customColorNotes: normalizedRows[0]?.customColorNotes || "",
        orderItems: normalizedRows,
        views: preparedViews,
      };
    });

    return NextResponse.json({ items, requestNumber: order.request_number });
  } catch (error) {
    console.error("Account reorder failed", error);
    return NextResponse.json({ error: "Could not prepare this reorder." }, { status: 500 });
  }
}
