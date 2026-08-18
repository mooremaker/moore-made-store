export type ShowcasePhotoPreview = {
  x: number;
  y: number;
  zoom: number;
};

export type ShowcasePhotoPreviewMap = Record<string, ShowcasePhotoPreview>;

export const DEFAULT_SHOWCASE_PHOTO_PREVIEW: ShowcasePhotoPreview = {
  x: 50,
  y: 50,
  zoom: 1,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeShowcasePhotoPreview(value: unknown): ShowcasePhotoPreview {
  if (!value || typeof value !== "object") return { ...DEFAULT_SHOWCASE_PHOTO_PREVIEW };
  const record = value as Record<string, unknown>;
  const x = typeof record.x === "number" && Number.isFinite(record.x) ? record.x : DEFAULT_SHOWCASE_PHOTO_PREVIEW.x;
  const y = typeof record.y === "number" && Number.isFinite(record.y) ? record.y : DEFAULT_SHOWCASE_PHOTO_PREVIEW.y;
  const zoom = typeof record.zoom === "number" && Number.isFinite(record.zoom) ? record.zoom : DEFAULT_SHOWCASE_PHOTO_PREVIEW.zoom;
  return {
    x: Math.round(clamp(x, 0, 100) * 10) / 10,
    y: Math.round(clamp(y, 0, 100) * 10) / 10,
    zoom: Math.round(clamp(zoom, 1, 2.25) * 100) / 100,
  };
}

export function normalizeShowcasePhotoPreviewMap(value: unknown): ShowcasePhotoPreviewMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: ShowcasePhotoPreviewMap = {};
  for (const [path, preview] of Object.entries(value as Record<string, unknown>)) {
    if (!path) continue;
    result[path] = normalizeShowcasePhotoPreview(preview);
  }
  return result;
}
