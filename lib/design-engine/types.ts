import type { MockupAssetRef, MockupDrawingStroke } from "@/lib/mockup-types";

export type DesignMockupType = "2d" | "3d";
export type DesignSurfaceId =
  | "front"
  | "back"
  | "left-sleeve"
  | "right-sleeve"
  | (string & {});
export type ArtworkImprovementRequest =
  | "remove-background"
  | "improve-artwork"
  | "recreate-vectorize-if-appropriate";

export type DesignTransform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
};

export type PrintQuality = {
  sourceWidthPx: number;
  sourceHeightPx: number;
  intendedWidthIn: number;
  intendedHeightIn: number;
  effectivePpi: number;
  rating: "excellent" | "good" | "fair" | "poor" | "unknown";
  message: string;
};

type BaseDesignLayer = DesignTransform & {
  id: string;
  name: string;
  placement: string;
  intendedWidthIn: number;
  intendedHeightIn: number;
  locked?: boolean;
  hidden?: boolean;
};

export type ImageDesignLayer = BaseDesignLayer & {
  kind: "image";
  source: MockupAssetRef & {
    mimeType?: string;
    sizeBytes?: number;
  };
  originalPixels?: { width: number; height: number } | null;
  quality: PrintQuality;
  improvementRequests: ArtworkImprovementRequest[];
  transparentSource?: MockupAssetRef | null;
};

export type TextDesignLayer = BaseDesignLayer & {
  kind: "text";
  text: string;
  fontFamily: string;
  fontLabel: string;
  fontWeight: 400 | 700 | 900;
  fontAsset?: MockupAssetRef | null;
  fontSizePt: number;
  color: string;
  textAlign: "left" | "center" | "right";
  letterSpacingEm: number;
};

export type DrawingDesignLayer = BaseDesignLayer & {
  kind: "drawing";
  strokes: MockupDrawingStroke[];
  drawingTool: "pen" | "marker";
};

export type DesignLayer =
  | ImageDesignLayer
  | TextDesignLayer
  | DrawingDesignLayer;

export type PlacementPreset = {
  id: string;
  label: string;
  surfaceId: DesignSurfaceId;
  x: number;
  y: number;
  width: number;
  intendedWidthIn: number;
};

export type DesignSurface = {
  id: DesignSurfaceId;
  label: string;
  enabled: boolean;
  printArea: { left: number; top: number; right: number; bottom: number };
  physicalSizeIn: { width: number; height: number };
  allowedPlacements: string[];
  layers: DesignLayer[];
};

export type ProductDesignConfiguration = {
  version: 1;
  productId: string;
  productType: string;
  mockupType: DesignMockupType;
  allowedMockupTypes: DesignMockupType[];
  model?: {
    format: "procedural-tee" | "procedural-polo" | "procedural-crewneck" | "glb" | "gltf";
    asset?: MockupAssetRef | null;
    scale?: number;
    rotation?: [number, number, number];
  } | null;
  surfaces: Omit<DesignSurface, "layers" | "enabled">[];
  placements: PlacementPreset[];
  maximumDesignSizeIn: { width: number; height: number };
};

export type CustomerProof = {
  generatedAt?: string;
  previews: Array<{ surfaceId: DesignSurfaceId; asset: MockupAssetRef }>;
  disclaimer: string;
};

export type ProductionManifest = {
  generatedAt?: string;
  sourceAssets: MockupAssetRef[];
  warnings: string[];
  notes?: string;
};

export type DesignDocumentV2 = {
  version: 2;
  id?: string;
  product: {
    id: string;
    name: string;
    type: string;
    mockupType: DesignMockupType;
    color: { name: string; value: string };
    variant?: string | null;
    configuration: ProductDesignConfiguration;
  };
  activeSurfaceId: DesignSurfaceId;
  surfaces: DesignSurface[];
  customerNotes?: string;
  proof: CustomerProof;
  production: ProductionManifest;
  createdAt: string;
  updatedAt: string;
};

export function isDesignDocumentV2(value: unknown): value is DesignDocumentV2 {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { version?: unknown }).version === 2 &&
      Array.isArray((value as { surfaces?: unknown }).surfaces),
  );
}
