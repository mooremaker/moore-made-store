import type { Product } from "@/lib/catalog";

export type CatalogMockupSettings = {
  productX: number;
  productY: number;
  productScale: number;
  productRotation: number;
  logoX: number;
  logoY: number;
  logoWidth: number;
  logoRotation: number;
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

export function defaultCatalogMockupSettings(product: Product): CatalogMockupSettings {
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
  };
}

export function normalizeCatalogMockupSettings(product: Product, value: unknown): CatalogMockupSettings {
  const defaults = defaultCatalogMockupSettings(product);
  if (!value || typeof value !== "object") return defaults;
  const row = value as Record<string, unknown>;
  return {
    productX: finite(row.productX, defaults.productX, -50, 150),
    productY: finite(row.productY, defaults.productY, -50, 150),
    productScale: finite(row.productScale, defaults.productScale, 0.35, 2.5),
    productRotation: finite(row.productRotation, defaults.productRotation, -180, 180),
    logoX: finite(row.logoX, defaults.logoX, -50, 150),
    logoY: finite(row.logoY, defaults.logoY, -50, 150),
    logoWidth: finite(row.logoWidth, defaults.logoWidth, 4, 120),
    logoRotation: finite(row.logoRotation, defaults.logoRotation, -180, 180),
  };
}

export function catalogSettingsFromTemplateDocument(product: Product, document: unknown): CatalogMockupSettings {
  if (!document || typeof document !== "object") return defaultCatalogMockupSettings(product);
  const row = document as Record<string, unknown>;
  const catalog = row.catalog && typeof row.catalog === "object" ? row.catalog : row;
  return normalizeCatalogMockupSettings(product, catalog);
}

export function catalogTemplateDocument(product: Product, settings: CatalogMockupSettings) {
  return {
    version: 1,
    kind: "catalog-default",
    productSlug: product.slug,
    catalog: normalizeCatalogMockupSettings(product, settings),
  };
}
