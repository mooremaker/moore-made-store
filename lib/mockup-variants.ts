import { findProductColor, getProduct } from "@/lib/catalog";
import { orderItemQuantity, type StructuredOrderItem } from "@/lib/order-types";
import type { MockupDocument, MockupLayer, MockupView } from "@/lib/mockup-types";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizedFileKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function originalNameFromStoredPath(path: string) {
  const storedName = path.split("/").pop() || "Customer artwork";
  try {
    return decodeURIComponent(storedName).replace(/^\d+-\d+-/, "") || "Customer artwork";
  } catch {
    return storedName.replace(/^\d+-\d+-/, "") || "Customer artwork";
  }
}

function artworkCanPreview(name: string) {
  return /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(name);
}

function viewKey(view: MockupView) {
  if (view.template?.viewKey === "back") return "back";
  if (view.template?.viewKey === "front") return "front";
  return /(^|[\s·_-])(back|side\s*2)([\s·_-]|$)/i.test(`${view.id} ${view.name}`) ? "back" : "front";
}

function sourceGroupId(view: MockupView) {
  return view.id.replace(/-(front|back)$/i, "").replace(/^(front|back)$/i, "");
}

function colorValue(productSlug: string, colorName: string, fallback?: string) {
  const product = getProduct(productSlug);
  return findProductColor(product, colorName)?.value
    || fallback
    || "#e6e0d8";
}

function safeOrderItems(value: unknown): StructuredOrderItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 60).map((raw, index) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const quantitiesRaw = row.quantities && typeof row.quantities === "object" ? row.quantities as Record<string, unknown> : {};
    const quantities: Record<string, number> = {};
    for (const [size, quantity] of Object.entries(quantitiesRaw).slice(0, 40)) {
      const safeSize = text(size, 80);
      if (safeSize) quantities[safeSize] = Math.max(0, Math.floor(Number(quantity) || 0));
    }
    return {
      id: text(row.id, 180) || `item-${index + 1}`,
      productSlug: text(row.productSlug, 160),
      productName: text(row.productName, 300) || "Custom item",
      colorName: text(row.colorName, 160) || "Default",
      quantities,
      notes: text(row.notes, 2000) || undefined,
      designRelationship: row.designRelationship === "primary" || row.designRelationship === "separate" ? row.designRelationship : "same",
    } satisfies StructuredOrderItem;
  }).filter((item) => item.productSlug && orderItemQuantity(item) > 0);
}

/**
 * Older customer requests could save the upload path on the order while missing
 * the corresponding editable mockup layer. Reconnect those files so existing
 * orders recover automatically when an admin opens Mockup Studio.
 */
export function reconnectCustomerArtwork(document: MockupDocument, artworkPaths: unknown): MockupDocument {
  const paths = Array.isArray(artworkPaths)
    ? artworkPaths.filter((path): path is string => typeof path === "string" && Boolean(path)).slice(0, 60)
    : [];
  if (!paths.length) return document;

  const usedPathIndexes = new Set<number>();
  let fallbackIndex = 0;
  const views = document.views.map((view) => {
    if (view.layers.length || view.customerIntent?.source !== "upload") return view;
    const fileName = view.customerIntent.artworkFileName || originalNameFromStoredPath(paths[Math.min(fallbackIndex, paths.length - 1)] || "");
    const wanted = normalizedFileKey(fileName);
    const matchingIndex = wanted ? paths.findIndex((path, index) => !usedPathIndexes.has(index) && normalizedFileKey(path).includes(wanted)) : -1;
    while (fallbackIndex < paths.length && usedPathIndexes.has(fallbackIndex)) fallbackIndex += 1;
    const selectedIndex = matchingIndex >= 0 ? matchingIndex : Math.min(fallbackIndex, paths.length - 1);
    const path = paths[selectedIndex];
    usedPathIndexes.add(selectedIndex);
    fallbackIndex += 1;
    if (!path) return view;
    const intent = view.customerIntent;
    const layer: MockupLayer = {
      id: `${view.id}-recovered-customer-artwork`,
      asset: { path, originalName: fileName, bucket: "custom-request-files" },
      x: intent.x,
      y: intent.y,
      width: intent.width,
      height: intent.height,
      rotation: intent.rotation,
      opacity: 1,
      zIndex: 1,
    };
    return { ...view, layers: [layer] };
  });
  return { ...document, views };
}

/** A customer upload must be visible on its requested view before it is proof-ready. */
export function missingPreviewArtworkViews(document: MockupDocument): MockupView[] {
  return document.views.filter((view) => {
    const intent = view.customerIntent;
    return Boolean(intent?.enabled && intent.source === "upload" && !view.layers.some((layer) => Boolean(layer.asset.path) && artworkCanPreview(layer.asset.originalName)));
  });
}

/** Build one editable proof view for every requested product/color/side. */
export function expandMockupVariants(document: MockupDocument, rawOrderItems: unknown): MockupDocument {
  const orderItems = safeOrderItems(rawOrderItems);
  if (!orderItems.length || !document.views.length) return document;

  const currentVariants = document.views.filter((view) => Boolean(view.template?.orderItemId));
  const sourceViews = document.views.filter((view) => !view.template?.orderItemId && Boolean(view.template?.productSlug));
  const manualViews = document.views.filter((view) => !view.template?.orderItemId && !view.template?.productSlug);
  const generated: MockupView[] = [];

  for (const item of orderItems) {
    const exact = currentVariants.filter((view) => view.template?.orderItemId === item.id);
    const grouped = sourceViews.filter((view) => {
      const groupId = sourceGroupId(view);
      return Boolean(groupId) && item.id.startsWith(`${groupId}-`);
    });
    const byProduct = sourceViews.filter((view) => view.template?.productSlug === item.productSlug);
    const variantFallback = currentVariants.filter((view) => view.template?.productSlug === item.productSlug);
    const candidates = exact.length ? exact : grouped.length ? grouped : byProduct.length ? byProduct : variantFallback;
    if (!candidates.length) continue;

    const sides = Array.from(new Set(candidates.map(viewKey)));
    for (const side of sides) {
      const existing = exact.find((view) => viewKey(view) === side);
      const source = existing
        || candidates.find((view) => viewKey(view) === side)
        || candidates[0];
      const product = getProduct(item.productSlug);
      const sideLabel = product?.viewLabels[side] || (side === "back" ? "Back" : "Front");
      const quantity = orderItemQuantity(item);
      const id = `requested-${item.id}-${side}`;
      const designGroupId = source.template?.designGroupId || sourceGroupId(source) || document.productSlug || item.productSlug;
      generated.push({
        ...source,
        id,
        name: `${item.productName} · ${item.colorName} · ${sideLabel}`,
        layers: source.layers.map((layer, index) => ({ ...layer, id: `${id}-layer-${index + 1}` })),
        exportAsset: existing?.exportAsset || null,
        template: {
          ...source.template,
          productSlug: item.productSlug,
          productName: item.productName,
          previewKind: product?.previewKind || source.template?.previewKind,
          colorName: item.colorName,
          colorValue: colorValue(item.productSlug, item.colorName, source.template?.colorValue),
          viewKey: side,
          designGroupId,
          orderItemId: item.id,
          quantity,
          designRelationship: item.designRelationship,
          orderItemNotes: item.notes,
        },
      });
    }
  }

  if (!generated.length) return document;
  const views = [...generated, ...manualViews];
  const activeExists = views.some((view) => view.id === document.activeViewId);
  return {
    ...document,
    views,
    activeViewId: activeExists ? document.activeViewId : views[0]?.id || null,
  };
}
