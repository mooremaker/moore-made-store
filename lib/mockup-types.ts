export type MockupAssetBucket =
  | "mockup-studio-files"
  | "custom-request-files"
  | "quote-proof-files";

export type MockupAssetRef = {
  path: string;
  originalName: string;
  bucket?: MockupAssetBucket;
  url?: string | null;
};

export type MockupLayer = {
  id: string;
  asset: MockupAssetRef;
  x: number;
  y: number;
  width: number;
  height?: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  locked?: boolean;
};

export type MockupDrawingPoint = { x: number; y: number };

export type MockupDrawingStroke = {
  color: string;
  width: number;
  tool?: "pen" | "marker" | "eraser";
  opacity?: number;
  points: MockupDrawingPoint[];
};

export type MockupVectorLayer = {
  id: string;
  kind: "text" | "drawing";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  text?: string;
  fontFamily?: string;
  fontLabel?: string;
  fontWeight?: 400 | 700 | 900;
  color?: string;
  textAlign?: "left" | "center" | "right";
  letterSpacingEm?: number;
  fontSizePt?: number;
  strokes?: MockupDrawingStroke[];
};

export type MockupCustomerIntent = {
  enabled: boolean;
  source: "example" | "upload" | "idea" | "text" | "drawing" | "mixed";
  placement: string;
  placementLabel?: string;
  idea?: string;
  details?: string;
  artworkFileName?: string;
  backgroundRemovalRequested?: boolean;
  artworkImprovementRequests?: import("@/lib/design-engine/types").ArtworkImprovementRequest[];
  sourceWidthPx?: number;
  sourceHeightPx?: number;
  intendedWidthIn?: number;
  intendedHeightIn?: number;
  printQuality?: import("@/lib/design-engine/types").PrintQuality;
  x: number;
  y: number;
  width: number;
  height?: number;
  rotation: number;
};

export type MockupTemplateRef = {
  productSlug?: string;
  productName?: string;
  previewKind?: string;
  colorName?: string;
  colorValue?: string;
  viewKey?: string;
  designGroupId?: string;
  orderItemId?: string;
  quantity?: number;
  designRelationship?: "primary" | "same" | "separate";
  orderItemNotes?: string;
};

export type MockupView = {
  id: string;
  name: string;
  base: MockupAssetRef | null;
  layers: MockupLayer[];
  vectorLayers?: MockupVectorLayer[];
  exportAsset?: MockupAssetRef | null;
  customerIntent?: MockupCustomerIntent | null;
  template?: MockupTemplateRef | null;
};

export type MockupDocument = {
  version: 1;
  views: MockupView[];
  activeViewId?: string | null;
  source?: "admin" | "customer";
  productSlug?: string | null;
  productName?: string | null;
  colorName?: string | null;
  previewKind?: string | null;
  /** Editable production source of truth for new designs. `views` remains a v1 compatibility projection. */
  designEngine?: import("@/lib/design-engine/types").DesignDocumentV2;
  /** One editable document per configured product when a combined cart contains multiple designs. */
  designDocuments?: import("@/lib/design-engine/types").DesignDocumentV2[];
};

export type MockupProjectRecord = {
  id: string;
  request_id: string;
  customer_user_id: string | null;
  title: string;
  status: "draft" | "proof_ready" | "archived";
  document: MockupDocument;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MockupProofExport = {
  viewId: string;
  title: string;
  path: string;
  originalName: string;
  url?: string | null;
};

export function emptyMockupDocument(): MockupDocument {
  return {
    version: 1,
    source: "admin",
    views: [
      { id: "front", name: "Front", base: null, layers: [] },
      { id: "back", name: "Back", base: null, layers: [] },
    ],
    activeViewId: "front",
  };
}
