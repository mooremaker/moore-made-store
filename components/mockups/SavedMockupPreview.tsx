import type { CSSProperties } from "react";
import { ProductVisual } from "@/components/shop/ProductVisual";
import type { ProductPreviewKind } from "@/lib/catalog";
import type { MockupDocument, MockupVectorLayer, MockupView } from "@/lib/mockup-types";

const VALID_KINDS = new Set<ProductPreviewKind>(["tee", "polo", "hoodie", "mug", "tote", "card", "bookmark", "coaster", "sticker", "custom"]);

function previewKind(view: MockupView, document: MockupDocument): ProductPreviewKind {
  const value = String(view.template?.previewKind || document.previewKind || "custom") as ProductPreviewKind;
  return VALID_KINDS.has(value) ? value : "custom";
}

function requestedViews(document: MockupDocument) {
  const active = document.views.filter((view) => view.customerIntent?.enabled || view.layers?.length || view.vectorLayers?.length || view.base || view.exportAsset);
  return active.length ? active : document.views.slice(0, 2);
}

function artworkCanPreview(name: string) {
  return /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(name);
}

function needsPlacedArtwork(view: MockupView) {
  return view.customerIntent?.enabled && view.customerIntent.source === "upload" && !view.layers.some((layer) => layer.asset.path && artworkCanPreview(layer.asset.originalName));
}

function MockupLayerVisual({ layer }: { layer: MockupView["layers"][number] }) {
  if (!layer.asset.url) return null;
  return (
    <div className={`savedMockupLayer ${artworkCanPreview(layer.asset.originalName) ? "" : "isUnsupported"}`} key={layer.id} style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: layer.height ? `${layer.height}%` : undefined, opacity: layer.opacity, zIndex: layer.zIndex, transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)` }}>
      {artworkCanPreview(layer.asset.originalName) ? <img src={layer.asset.url} alt={layer.asset.originalName} /> : <div className="savedMockupUnsupported"><strong>PREVIEW NEEDED</strong><span>{layer.asset.originalName}</span></div>}
    </div>
  );
}

function VectorLayerVisual({ layer }: { layer: MockupVectorLayer }) {
  return <div className={`savedMockupLayer savedMockupVectorLayer is-${layer.kind}`} style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%`, opacity: layer.opacity, zIndex: layer.zIndex, transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)` }}>
    {layer.kind === "text" ? <div className="customerTextArtwork" style={{ color: layer.color, fontFamily: layer.fontFamily, fontWeight: layer.fontWeight, textAlign: layer.textAlign }}>{layer.text}</div> : <svg className="customerDrawingArtwork" viewBox="0 0 1000 600" preserveAspectRatio="none">{(layer.strokes || []).map((stroke, index) => <path key={index} d={stroke.points.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${point.x} ${point.y}`).join(" ")} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />)}</svg>}
  </div>;
}

export function SavedMockupPreview({
  document,
  compact = false,
  title = "Saved mockup",
  className = "",
}: {
  document: MockupDocument;
  compact?: boolean;
  title?: string;
  className?: string;
}) {
  const views = requestedViews(document);
  if (!views.length) return null;

  return (
    <section className={`savedMockupPreview ${compact ? "isCompact" : ""} ${className}`.trim()}>
      <div className="savedMockupPreviewHead">
        <div><strong>{title}</strong><span>{document.source === "customer" ? "Created from the customer’s Shop customization" : "Current Moore Made mockup"}</span></div>
        <small>{views.length} view{views.length === 1 ? "" : "s"}</small>
      </div>
      <div className="savedMockupPreviewGrid">
        {views.map((view) => {
          const kind = previewKind(view, document);
          const color = view.template?.colorValue || "#ece7df";
          const exported = view.exportAsset?.url;
          return (
            <article className="savedMockupView" key={view.id}>
              <div className="savedMockupViewLabel"><strong>{view.name}</strong><span>{view.template?.quantity ? `${view.template.quantity} pc${view.template.quantity === 1 ? "" : "s"} · ` : ""}{view.customerIntent?.placementLabel || view.customerIntent?.placement || "Custom placement"}</span></div>
              <div className="savedMockupStage">
                {exported ? (
                  <img className="savedMockupExport" src={exported} alt={`${view.name} mockup`} />
                ) : view.base?.url ? (
                  <div className="savedMockupBaseStage">
                    <img className="savedMockupBase" src={view.base.url} alt={`${view.name} product`} />
                    {(view.layers || []).map((layer) => <MockupLayerVisual layer={layer} key={layer.id} />)}
                    {(view.vectorLayers || []).map((layer) => <VectorLayerVisual layer={layer} key={layer.id} />)}
                  </div>
                ) : (
                  <ProductVisual kind={kind} view={view.template?.viewKey === "back" ? "back" : "front"} label={view.template?.viewKey === "back" ? "BACK" : "FRONT"} color={color} className="savedMockupProductVisual">
                    {(view.layers || []).map((layer) => <MockupLayerVisual layer={layer} key={layer.id} />)}
                    {(view.vectorLayers || []).map((layer) => <VectorLayerVisual layer={layer} key={layer.id} />)}
                    {view.customerIntent?.enabled && view.customerIntent.idea ? (
                      <div className="savedMockupIdea" style={{ left: `${view.customerIntent.x}%`, top: `${view.customerIntent.y}%`, width: `${view.customerIntent.width}%`, height: view.customerIntent.height ? `${view.customerIntent.height}%` : undefined, transform: `translate(-50%, -50%) rotate(${view.customerIntent.rotation}deg)` } as CSSProperties}>
                        <strong>DESIGN IDEA</strong><span>{view.customerIntent.idea || view.customerIntent.placementLabel || "Moore Made to create"}</span>
                      </div>
                    ) : null}
                    {needsPlacedArtwork(view) ? <div className="savedMockupMissingArtwork"><strong>ORIGINAL FILE MISSING</strong><span>{view.customerIntent?.artworkFileName || "Customer upload"}</span><small>Ask the customer to resend it before quoting.</small></div> : null}
                  </ProductVisual>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
