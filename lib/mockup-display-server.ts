import type { MockupAssetRef, MockupDocument, MockupView } from "@/lib/mockup-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const DEFAULT_BUCKET = "mockup-studio-files";
const PROOF_BUCKET = "quote-proof-files";

function safeDocument(value: unknown): MockupDocument | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<MockupDocument> & { views?: unknown };
  if (!Array.isArray(raw.views) || raw.views.length === 0) return null;
  return raw as MockupDocument;
}

async function signRef(ref: MockupAssetRef | null | undefined, expiresIn: number) {
  if (!ref?.path) return ref || null;
  const bucket = ref.bucket || DEFAULT_BUCKET;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.storage.from(bucket).createSignedUrl(ref.path, expiresIn);
  return { ...ref, url: data?.signedUrl || null };
}

export async function signMockupDocumentForDisplay(value: unknown, expiresIn = 1800): Promise<MockupDocument | null> {
  const document = safeDocument(value);
  if (!document) return null;

  const views: MockupView[] = await Promise.all(document.views.map(async (view) => ({
    ...view,
    base: await signRef(view.base, expiresIn),
    layers: await Promise.all((view.layers || []).map(async (layer) => ({
      ...layer,
      asset: (await signRef(layer.asset, expiresIn))!,
    }))),
    exportAsset: await signRef(view.exportAsset ? { ...view.exportAsset, bucket: view.exportAsset.bucket || PROOF_BUCKET } : null, expiresIn),
  })));

  return { ...document, views };
}
