import type { Product } from "@/lib/catalog";
import { calculatePrintQuality } from "@/lib/design-engine/quality";
import { createDesignDocument } from "@/lib/design-engine/product-config";
import type {
  DesignDocumentV2,
  DesignLayer,
  DrawingDesignLayer,
  ImageDesignLayer,
  ProductDesignConfiguration,
  TextDesignLayer,
} from "@/lib/design-engine/types";
import type { MockupView } from "@/lib/mockup-types";

function intendedSize(
  view: MockupView,
  widthPercent: number,
  heightPercent: number,
  physical: { width: number; height: number },
  printArea: { left: number; right: number; top: number; bottom: number },
  useCustomerIntent = false,
) {
  return {
    width:
      useCustomerIntent && view.customerIntent?.intendedWidthIn
        ? view.customerIntent.intendedWidthIn
        : Math.max(
            0.5,
            (physical.width * widthPercent) /
              Math.max(1, printArea.right - printArea.left),
          ),
    height:
      useCustomerIntent && view.customerIntent?.intendedHeightIn
        ? view.customerIntent.intendedHeightIn
        : Math.max(
            0.5,
            (physical.height * heightPercent) /
              Math.max(1, printArea.bottom - printArea.top),
          ),
  };
}

export function buildDesignDocumentFromViews(
  product: Product,
  color: { name: string; value: string },
  configuration: ProductDesignConfiguration,
  views: MockupView[],
): DesignDocumentV2 {
  const document = createDesignDocument(product, color, configuration);
  document.surfaces = document.surfaces.map((surface) => {
    const view = views.find(
      (candidate) =>
        candidate.id === surface.id ||
        candidate.template?.viewKey === surface.id,
    );
    if (!view) return surface;
    const layers: DesignLayer[] = [];
    for (const layer of view.layers || []) {
      const size = intendedSize(
        view,
        layer.width,
        layer.height || layer.width,
        surface.physicalSizeIn,
        surface.printArea,
        true,
      );
      const sourceWidthPx = view.customerIntent?.sourceWidthPx || 0;
      const sourceHeightPx = view.customerIntent?.sourceHeightPx || 0;
      const imageLayer: ImageDesignLayer = {
        id: layer.id,
        kind: "image",
        name: layer.asset.originalName,
        source: layer.asset,
        originalPixels:
          sourceWidthPx && sourceHeightPx
            ? { width: sourceWidthPx, height: sourceHeightPx }
            : null,
        placement: view.customerIntent?.placement || "custom",
        intendedWidthIn: size.width,
        intendedHeightIn: size.height,
        quality:
          view.customerIntent?.printQuality ||
          calculatePrintQuality(
            sourceWidthPx,
            sourceHeightPx,
            size.width,
            size.height,
          ),
        improvementRequests:
          view.customerIntent?.artworkImprovementRequests ||
          (view.customerIntent?.backgroundRemovalRequested
            ? ["remove-background"]
            : []),
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height || layer.width,
        rotation: layer.rotation,
        opacity: layer.opacity,
        zIndex: layer.zIndex,
      };
      layers.push(imageLayer);
    }
    for (const layer of view.vectorLayers || []) {
      const size = intendedSize(
        view,
        layer.width,
        layer.height,
        surface.physicalSizeIn,
        surface.printArea,
      );
      if (layer.kind === "text") {
        const textLayer: TextDesignLayer = {
          id: layer.id,
          kind: "text",
          name: layer.name,
          placement: view.customerIntent?.placement || "custom",
          intendedWidthIn: size.width,
          intendedHeightIn: size.height,
          x: layer.x,
          y: layer.y,
          width: layer.width,
          height: layer.height,
          rotation: layer.rotation,
          opacity: layer.opacity,
          zIndex: layer.zIndex,
          text: layer.text || "",
          fontFamily: layer.fontFamily || "Arial, sans-serif",
          fontLabel: layer.fontLabel || "Saved font",
          fontWeight: layer.fontWeight || 700,
          fontSizePt:
            layer.fontSizePt ||
            Math.max(8, Math.round(size.height * 72 * 0.65)),
          color: layer.color || "#171717",
          textAlign: layer.textAlign || "center",
          letterSpacingEm: layer.letterSpacingEm || 0,
        };
        layers.push(textLayer);
      } else {
        const drawingLayer: DrawingDesignLayer = {
          id: layer.id,
          kind: "drawing",
          name: layer.name,
          placement: view.customerIntent?.placement || "custom",
          intendedWidthIn: size.width,
          intendedHeightIn: size.height,
          x: layer.x,
          y: layer.y,
          width: layer.width,
          height: layer.height,
          rotation: layer.rotation,
          opacity: layer.opacity,
          zIndex: layer.zIndex,
          strokes: layer.strokes || [],
          drawingTool: "pen",
        };
        layers.push(drawingLayer);
      }
    }
    return {
      ...surface,
      enabled: Boolean(view.customerIntent?.enabled || layers.length),
      layers: layers.sort((a, b) => a.zIndex - b.zIndex),
    };
  });
  document.activeSurfaceId =
    views.find((view) => view.customerIntent?.enabled)?.template?.viewKey ||
    "front";
  document.production.sourceAssets = document.surfaces.flatMap((surface) =>
    surface.layers
      .filter((layer): layer is ImageDesignLayer => layer.kind === "image")
      .map((layer) => layer.source),
  );
  document.production.warnings = document.surfaces.flatMap((surface) =>
    surface.layers
      .filter(
        (layer): layer is ImageDesignLayer =>
          layer.kind === "image" &&
          (layer.quality.rating === "fair" || layer.quality.rating === "poor"),
      )
      .map((layer) => `${surface.label}: ${layer.quality.message}`),
  );
  return document;
}
