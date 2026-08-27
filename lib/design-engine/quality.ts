import type { PrintQuality } from "@/lib/design-engine/types";

export function calculatePrintQuality(
  sourceWidthPx: number,
  sourceHeightPx: number,
  intendedWidthIn: number,
  intendedHeightIn: number,
): PrintQuality {
  const valid = [
    sourceWidthPx,
    sourceHeightPx,
    intendedWidthIn,
    intendedHeightIn,
  ].every((value) => Number.isFinite(value) && value > 0);
  if (!valid) {
    return {
      sourceWidthPx: Math.max(0, sourceWidthPx || 0),
      sourceHeightPx: Math.max(0, sourceHeightPx || 0),
      intendedWidthIn: Math.max(0, intendedWidthIn || 0),
      intendedHeightIn: Math.max(0, intendedHeightIn || 0),
      effectivePpi: 0,
      rating: "unknown",
      message:
        "Print quality will be checked after the original artwork is available.",
    };
  }

  const effectivePpi = Math.round(
    Math.min(
      sourceWidthPx / intendedWidthIn,
      sourceHeightPx / intendedHeightIn,
    ),
  );
  if (effectivePpi >= 300)
    return {
      sourceWidthPx,
      sourceHeightPx,
      intendedWidthIn,
      intendedHeightIn,
      effectivePpi,
      rating: "excellent",
      message: "Print Quality: Excellent ✓",
    };
  if (effectivePpi >= 200)
    return {
      sourceWidthPx,
      sourceHeightPx,
      intendedWidthIn,
      intendedHeightIn,
      effectivePpi,
      rating: "good",
      message: "Print Quality: Good ✓",
    };
  if (effectivePpi >= 150)
    return {
      sourceWidthPx,
      sourceHeightPx,
      intendedWidthIn,
      intendedHeightIn,
      effectivePpi,
      rating: "fair",
      message: "Print Quality: Fair ⚠️",
    };
  return {
    sourceWidthPx,
    sourceHeightPx,
    intendedWidthIn,
    intendedHeightIn,
    effectivePpi,
    rating: "poor",
    message: "This image may appear blurry when printed at the selected size.",
  };
}

export function printQualityLabel(quality: PrintQuality) {
  return quality.rating === "unknown"
    ? quality.message
    : `${quality.message} · ${quality.effectivePpi} effective PPI`;
}
