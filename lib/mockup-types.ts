export type MockupAssetRef = {
  path: string;
  originalName: string;
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

export type MockupView = {
  id: string;
  name: string;
  base: MockupAssetRef | null;
  layers: MockupLayer[];
  exportAsset?: MockupAssetRef | null;
};

export type MockupDocument = {
  version: 1;
  views: MockupView[];
  activeViewId?: string | null;
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
    views: [
      { id: "front", name: "Front", base: null, layers: [] },
      { id: "back", name: "Back", base: null, layers: [] },
    ],
    activeViewId: "front",
  };
}
