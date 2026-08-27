import type { Product } from "@/lib/catalog";
import { defaultProductDesignConfiguration } from "@/lib/design-engine/product-config";
import type { ProductDesignConfiguration } from "@/lib/design-engine/types";

export type CatalogMockupSettings = {
  productX: number;
  productY: number;
  productScale: number;
  productRotation: number;
  logoX: number;
  logoY: number;
  logoWidth: number;
  logoRotation: number;
  designEngine: ProductDesignConfiguration;
};

export type ProductMockupTemplateRecord = {
  id: string;
  name: string;
  product_key: string | null;
  color_name: string | null;
  visibility: "admin" | "client" | "shop";
  template_document: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ShopMockupTemplateMap = Record<string, CatalogMockupSettings>;

function finite(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function defaultCatalogMockupSettings(
  product: Product,
): CatalogMockupSettings {
  const preview = product.catalogPreview;
  return {
    productX: 50,
    productY: 50,
    productScale: 1,
    productRotation: 0,
    logoX: preview?.logoX ?? 50,
    logoY: preview?.logoY ?? 50,
    logoWidth: preview?.logoWidth ?? 30,
    logoRotation: preview?.logoRotation ?? 0,
    designEngine: defaultProductDesignConfiguration(product),
  };
}

export function normalizeCatalogMockupSettings(
  product: Product,
  value: unknown,
): CatalogMockupSettings {
  const defaults = defaultCatalogMockupSettings(product);
  if (!value || typeof value !== "object") return defaults;
  const row = value as Record<string, unknown>;
  return {
    productX: finite(row.productX, defaults.productX, -50, 150),
    productY: finite(row.productY, defaults.productY, -50, 150),
    productScale: finite(row.productScale, defaults.productScale, 0.35, 2.5),
    productRotation: finite(
      row.productRotation,
      defaults.productRotation,
      -180,
      180,
    ),
    logoX: finite(row.logoX, defaults.logoX, -50, 150),
    logoY: finite(row.logoY, defaults.logoY, -50, 150),
    logoWidth: finite(row.logoWidth, defaults.logoWidth, 4, 120),
    logoRotation: finite(row.logoRotation, defaults.logoRotation, -180, 180),
    designEngine: normalizeProductDesignConfiguration(
      product,
      row.designEngine,
      defaults.designEngine,
    ),
  };
}

function normalizeProductDesignConfiguration(
  product: Product,
  value: unknown,
  fallback = defaultProductDesignConfiguration(product),
): ProductDesignConfiguration {
  if (!value || typeof value !== "object") return fallback;
  const row = value as Partial<ProductDesignConfiguration>;
  const allowedMockupTypes = Array.isArray(row.allowedMockupTypes)
    ? row.allowedMockupTypes.filter(
        (item): item is "2d" | "3d" => item === "2d" || item === "3d",
      )
    : fallback.allowedMockupTypes;
  const supports3d =
    allowedMockupTypes.includes("3d") &&
    (row.model?.format === "procedural-tee" ||
      row.model?.format === "procedural-polo" ||
      row.model?.format === "procedural-crewneck" ||
      row.model?.format === "glb" ||
      row.model?.format === "gltf");
  const mockupType = row.mockupType === "3d" && supports3d ? "3d" : "2d";
  return {
    ...fallback,
    mockupType,
    allowedMockupTypes: allowedMockupTypes.length
      ? allowedMockupTypes
      : fallback.allowedMockupTypes,
    model: supports3d ? row.model || fallback.model : fallback.model,
    surfaces:
      Array.isArray(row.surfaces) && row.surfaces.length
        ? row.surfaces
        : fallback.surfaces,
    placements:
      Array.isArray(row.placements) && row.placements.length
        ? row.placements
        : fallback.placements,
    maximumDesignSizeIn:
      row.maximumDesignSizeIn &&
      Number(row.maximumDesignSizeIn.width) > 0 &&
      Number(row.maximumDesignSizeIn.height) > 0
        ? row.maximumDesignSizeIn
        : fallback.maximumDesignSizeIn,
  };
}

export function catalogSettingsFromTemplateDocument(
  product: Product,
  document: unknown,
): CatalogMockupSettings {
  if (!document || typeof document !== "object")
    return defaultCatalogMockupSettings(product);
  const row = document as Record<string, unknown>;
  const catalog =
    row.catalog && typeof row.catalog === "object" ? row.catalog : row;
  return normalizeCatalogMockupSettings(product, catalog);
}

export function catalogTemplateDocument(
  product: Product,
  settings: CatalogMockupSettings,
) {
  return {
    version: 2,
    kind: "catalog-default",
    productSlug: product.slug,
    catalog: normalizeCatalogMockupSettings(product, settings),
  };
}
