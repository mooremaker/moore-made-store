import type { CSSProperties } from "react";
import { ProductVisual } from "@/components/shop/ProductVisual";
import type { ProductPreviewKind } from "@/lib/catalog";
import type { MockupDocument, MockupView } from "@/lib/mockup-types";

const VALID_KINDS = new Set<ProductPreviewKind>(["tee", "polo", "hoodie", "mug", "tote", "card", "bookmark", "coaster", "sticker", "custom"]);

function previewKind(view: MockupView, document: MockupDocument): ProductPreviewKind {
  const value = String(view.template?.previewKind || document.previewKind || "custom") as ProductPreviewKind;
  return VALID_KINDS.has(value) ? value : "custom";
}

function requestedViews(document: MockupDocument) {
  const active = document.views.filter((view) => view.customerIntent?.enabled || view.layers?.length || view.base || view.exportAsset);
  return active.length ? active : document.views.slice(0, 2);
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
              <div className="savedMockupViewLabel"><strong>{view.name}</strong><span>{view.customerIntent?.placementLabel || view.customerIntent?.placement || "Custom placement"}</span></div>
              <div className="savedMockupStage">
                {exported ? (
                  <img className="savedMockupExport" src={exported} alt={`${view.name} mockup`} />
                ) : view.base?.url ? (
                  <div className="savedMockupBaseStage">
                    <img className="savedMockupBase" src={view.base.url} alt={`${view.name} product`} />
                    {(view.layers || []).map((layer) => layer.asset.url ? (
                      <div className="savedMockupLayer" key={layer.id} style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, opacity: layer.opacity, zIndex: layer.zIndex, transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)` }}>
                        <img src={layer.asset.url} alt={layer.asset.originalName} />
                      </div>
                    ) : null)}
                  </div>
                ) : (
                  <ProductVisual kind={kind} color={color} className="savedMockupProductVisual">
                    {(view.layers || []).map((layer) => layer.asset.url ? (
                      <div className="savedMockupLayer" key={layer.id} style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, opacity: layer.opacity, zIndex: layer.zIndex, transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)` }}>
                        <img src={layer.asset.url} alt={layer.asset.originalName} />
                      </div>
                    ) : null)}
                    {view.customerIntent?.enabled && view.customerIntent.source === "idea" ? (
                      <div className="savedMockupIdea" style={{ left: `${view.customerIntent.x}%`, top: `${view.customerIntent.y}%`, width: `${view.customerIntent.width}%`, transform: `translate(-50%, -50%) rotate(${view.customerIntent.rotation}deg)` } as CSSProperties}>
                        <strong>DESIGN IDEA</strong><span>{view.customerIntent.idea || view.customerIntent.placementLabel || "Moore Made to create"}</span>
                      </div>
                    ) : null}
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
