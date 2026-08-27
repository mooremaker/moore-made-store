import type { Product } from "@/lib/catalog";
import type {
  DesignDocumentV2,
  DesignSurface,
  ProductDesignConfiguration,
} from "@/lib/design-engine/types";

const apparelPlacements = [
  {
    id: "left-chest",
    label: "Left Chest",
    surfaceId: "front",
    x: 61,
    y: 40,
    width: 19,
    intendedWidthIn: 4,
  },
  {
    id: "right-chest",
    label: "Right Chest",
    surfaceId: "front",
    x: 39,
    y: 40,
    width: 19,
    intendedWidthIn: 4,
  },
  {
    id: "center-chest",
    label: "Center Chest",
    surfaceId: "front",
    x: 50,
    y: 40,
    width: 30,
    intendedWidthIn: 8,
  },
  {
    id: "full-front",
    label: "Full Front",
    surfaceId: "front",
    x: 50,
    y: 51,
    width: 50,
    intendedWidthIn: 12,
  },
  {
    id: "upper-back",
    label: "Upper Back",
    surfaceId: "back",
    x: 50,
    y: 34,
    width: 27,
    intendedWidthIn: 8,
  },
  {
    id: "back-center",
    label: "Back Center",
    surfaceId: "back",
    x: 50,
    y: 48,
    width: 34,
    intendedWidthIn: 10,
  },
  {
    id: "full-back",
    label: "Full Back",
    surfaceId: "back",
    x: 50,
    y: 50,
    width: 45,
    intendedWidthIn: 12,
  },
  {
    id: "left-sleeve",
    label: "Left Sleeve",
    surfaceId: "left-sleeve",
    x: 50,
    y: 50,
    width: 55,
    intendedWidthIn: 4,
  },
  {
    id: "right-sleeve",
    label: "Right Sleeve",
    surfaceId: "right-sleeve",
    x: 50,
    y: 50,
    width: 55,
    intendedWidthIn: 4,
  },
  {
    id: "custom-front",
    label: "Custom",
    surfaceId: "front",
    x: 50,
    y: 48,
    width: 36,
    intendedWidthIn: 9,
  },
  {
    id: "custom-back",
    label: "Custom",
    surfaceId: "back",
    x: 50,
    y: 48,
    width: 36,
    intendedWidthIn: 9,
  },
] satisfies ProductDesignConfiguration["placements"];

function apparelSurfaces(): ProductDesignConfiguration["surfaces"] {
  return [
    {
      id: "front",
      label: "Front",
      printArea: { left: 30, right: 70, top: 20, bottom: 82 },
      physicalSizeIn: { width: 12, height: 16 },
      allowedPlacements: [
        "left-chest",
        "right-chest",
        "center-chest",
        "full-front",
        "custom-front",
      ],
    },
    {
      id: "back",
      label: "Back",
      printArea: { left: 30, right: 70, top: 20, bottom: 82 },
      physicalSizeIn: { width: 12, height: 16 },
      allowedPlacements: [
        "upper-back",
        "back-center",
        "full-back",
        "custom-back",
      ],
    },
    {
      id: "left-sleeve",
      label: "Left Sleeve",
      printArea: { left: 18, right: 82, top: 20, bottom: 80 },
      physicalSizeIn: { width: 4, height: 4 },
      allowedPlacements: ["left-sleeve"],
    },
    {
      id: "right-sleeve",
      label: "Right Sleeve",
      printArea: { left: 18, right: 82, top: 20, bottom: 80 },
      physicalSizeIn: { width: 4, height: 4 },
      allowedPlacements: ["right-sleeve"],
    },
  ];
}

export function defaultProductDesignConfiguration(
  product: Product,
): ProductDesignConfiguration {
  const apparel = ["tee", "polo", "hoodie"].includes(product.previewKind);
  if (apparel) {
    const starterFormat =
      product.previewKind === "tee"
        ? "procedural-tee"
        : product.previewKind === "polo"
          ? "procedural-polo"
          : "procedural-crewneck";
    return {
      version: 1,
      productId: product.slug,
      productType: product.previewKind,
      mockupType: "3d",
      allowedMockupTypes: ["2d", "3d"],
      model: { format: starterFormat, asset: null, scale: 1 },
      surfaces: apparelSurfaces(),
      placements: apparelPlacements,
      maximumDesignSizeIn: { width: 12, height: 16 },
    };
  }

  return {
    version: 1,
    productId: product.slug,
    productType: product.previewKind,
    mockupType: "2d",
    allowedMockupTypes: ["2d"],
    model: null,
    surfaces: [
      {
        id: "front",
        label: product.viewLabels.front,
        printArea: { left: 20, right: 80, top: 16, bottom: 84 },
        physicalSizeIn: { width: 10, height: 10 },
        allowedPlacements: product.placements.front.map((item) => item.value),
      },
      ...(product.supportsBack
        ? [
            {
              id: "back",
              label: product.viewLabels.back,
              printArea: { left: 20, right: 80, top: 16, bottom: 84 },
              physicalSizeIn: { width: 10, height: 10 },
              allowedPlacements: product.placements.back.map(
                (item) => item.value,
              ),
            },
          ]
        : []),
    ],
    placements: [
      ...product.placements.front.map((item) => ({
        id: item.value,
        label: item.label,
        surfaceId: "front",
        x: item.x,
        y: item.y,
        width: item.width,
        intendedWidthIn: 6,
      })),
      ...product.placements.back.map((item) => ({
        id: item.value,
        label: item.label,
        surfaceId: "back",
        x: item.x,
        y: item.y,
        width: item.width,
        intendedWidthIn: 6,
      })),
    ],
    maximumDesignSizeIn: { width: 10, height: 10 },
  };
}

export function createDesignDocument(
  product: Product,
  color: { name: string; value: string },
  configuration = defaultProductDesignConfiguration(product),
): DesignDocumentV2 {
  const now = new Date().toISOString();
  const surfaces: DesignSurface[] = configuration.surfaces.map((surface) => ({
    ...surface,
    enabled: surface.id === "front",
    layers: [],
  }));
  return {
    version: 2,
    product: {
      id: product.slug,
      name: product.name,
      type: product.previewKind,
      mockupType: configuration.mockupType,
      color,
      configuration,
    },
    activeSurfaceId: "front",
    surfaces,
    proof: {
      previews: [],
      disclaimer:
        "Preview color is approximate. Final blank color may vary slightly due to fabric, dye-lot, screen, and production differences.",
    },
    production: { sourceAssets: [], warnings: [] },
    createdAt: now,
    updatedAt: now,
  };
}
