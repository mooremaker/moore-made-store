export type MockupAssetBucket = "mockup-studio-files" | "custom-request-files" | "quote-proof-files";

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
  rotation: number;
  opacity: number;
  zIndex: number;
  locked?: boolean;
};

export type MockupCustomerIntent = {
  enabled: boolean;
  source: "example" | "upload" | "idea";
  placement: string;
  placementLabel?: string;
  idea?: string;
  artworkFileName?: string;
  x: number;
  y: number;
  width: number;
  rotation: number;
};

export type MockupTemplateRef = {
  productSlug?: string;
  productName?: string;
  previewKind?: string;
  colorName?: string;
  colorValue?: string;
  viewKey?: string;
};

export type MockupView = {
  id: string;
  name: string;
  base: MockupAssetRef | null;
  layers: MockupLayer[];
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
