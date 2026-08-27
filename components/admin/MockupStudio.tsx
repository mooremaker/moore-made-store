"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { ProductVisual } from "@/components/shop/ProductVisual";
import { getProduct, type ProductPreviewKind } from "@/lib/catalog";
import { buildDesignDocumentFromViews } from "@/lib/design-engine/legacy-adapter";
import {
  emptyMockupDocument,
  type MockupAssetRef,
  type MockupDocument,
  type MockupLayer,
  type MockupVectorLayer,
  type MockupView,
} from "@/lib/mockup-types";
import { missingPreviewArtworkViews } from "@/lib/mockup-variants";

const MOCKUP_BUCKET = "mockup-studio-files";
const PROOF_BUCKET = "quote-proof-files";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const PREVIEW_KINDS = new Set<ProductPreviewKind>([
  "tee",
  "polo",
  "hoodie",
  "mug",
  "tote",
  "card",
  "bookmark",
  "coaster",
  "sticker",
  "custom",
]);

function previewKind(value: unknown): ProductPreviewKind | null {
  return typeof value === "string" &&
    PREVIEW_KINDS.has(value as ProductPreviewKind)
    ? (value as ProductPreviewKind)
    : null;
}

function artworkCanPreview(name: string) {
  return /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(name);
}

function uid(prefix = "item") {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cleanDocument(document: MockupDocument): MockupDocument {
  const cleaned: MockupDocument = {
    ...document,
    views: document.views.map((view) => ({
      ...view,
      base: view.base
        ? {
            path: view.base.path,
            originalName: view.base.originalName,
            bucket: view.base.bucket,
          }
        : null,
      layers: view.layers.map((layer) => ({
        ...layer,
        asset: {
          path: layer.asset.path,
          originalName: layer.asset.originalName,
          bucket: layer.asset.bucket,
        },
      })),
      exportAsset: view.exportAsset
        ? {
            path: view.exportAsset.path,
            originalName: view.exportAsset.originalName,
            bucket: view.exportAsset.bucket,
          }
        : null,
    })),
  };
  const sources = document.designDocuments?.length
    ? document.designDocuments
    : document.designEngine
      ? [document.designEngine]
      : [];
  cleaned.designDocuments = sources.flatMap((source) => {
    const product = getProduct(source.product.id);
    if (!product) return [source];
    const views = cleaned.views.filter(
      (view) =>
        view.template?.productSlug === source.product.id ||
        cleaned.views.length <= 2,
    );
    const rebuilt = buildDesignDocumentFromViews(
      product,
      source.product.color,
      source.product.configuration,
      views,
    );
    rebuilt.proof = {
      ...source.proof,
      generatedAt: views.some((view) => view.exportAsset?.path)
        ? new Date().toISOString()
        : source.proof.generatedAt,
      previews: views.flatMap((view) =>
        view.exportAsset
          ? [
              {
                surfaceId: view.template?.viewKey || view.id,
                asset: view.exportAsset,
              },
            ]
          : [],
      ),
    };
    return [rebuilt];
  });
  cleaned.designEngine =
    cleaned.designDocuments.length === 1
      ? cleaned.designDocuments[0]
      : undefined;
  return cleaned;
}

async function uploadFiles(
  requestId: string,
  purpose: string,
  files: File[],
  bucket = MOCKUP_BUCKET,
) {
  const oversized = files.find((file) => file.size > MAX_FILE_BYTES);
  if (oversized) throw new Error(`${oversized.name} is larger than 20 MB.`);
  const endpoint =
    bucket === PROOF_BUCKET
      ? "/api/admin/quote-proof-uploads"
      : "/api/admin/mockups/uploads";
  const body =
    bucket === PROOF_BUCKET
      ? {
          requestId,
          itemKey: purpose,
          files: files.map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
          })),
        }
      : {
          requestId,
          purpose,
          files: files.map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
          })),
        };
  const preparedResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const prepared = await preparedResponse.json();
  if (!preparedResponse.ok)
    throw new Error(prepared.error || "Could not prepare the upload.");
  const supabase = getSupabaseBrowser();
  const result: MockupAssetRef[] = [];
  for (const target of prepared.uploads ?? []) {
    const file = files[target.index];
    if (!file) continue;
    const { error } = await supabase.storage
      .from(bucket)
      .uploadToSignedUrl(target.path, target.token, file, {
        contentType: file.type || undefined,
      });
    if (error) throw new Error(`Could not upload ${file.name}.`);
    result.push({
      path: target.path,
      originalName: file.name,
      url: URL.createObjectURL(file),
    });
  }
  return result;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new Error("One of the mockup images could not be loaded for export."),
      );
    image.src = src;
  });
}

async function renderView(view: MockupView) {
  if (!view.base?.url)
    throw new Error(
      `${view.name} can be attached to the quote as a saved mockup now. Upload a real blank/base image only if you also want a flattened PNG export.`,
    );
  const base = await loadImage(view.base.url);
  const canvas = document.createElement("canvas");
  canvas.width = base.naturalWidth || base.width;
  canvas.height = base.naturalHeight || base.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not create the mockup export.");
  ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

  for (const layer of [...view.layers].sort((a, b) => a.zIndex - b.zIndex)) {
    if (!layer.asset.url) continue;
    const image = await loadImage(layer.asset.url);
    const width = canvas.width * (layer.width / 100);
    const height =
      width *
      ((image.naturalHeight || image.height) /
        Math.max(1, image.naturalWidth || image.width));
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.translate(
      canvas.width * (layer.x / 100),
      canvas.height * (layer.y / 100),
    );
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }
  for (const layer of [...(view.vectorLayers || [])].sort(
    (a, b) => a.zIndex - b.zIndex,
  )) {
    const centerX = canvas.width * (layer.x / 100);
    const centerY = canvas.height * (layer.y / 100);
    const width = canvas.width * (layer.width / 100);
    const height = canvas.height * (layer.height / 100);
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.translate(centerX, centerY);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    if (layer.kind === "text") {
      const lines = (layer.text || "").split(/\r?\n/).slice(0, 10);
      const fontSize = Math.max(8, (height / Math.max(1, lines.length)) * 0.72);
      ctx.fillStyle = layer.color || "#171717";
      ctx.font = `${layer.fontWeight || 700} ${fontSize}px ${layer.fontFamily || "Arial, sans-serif"}`;
      ctx.textAlign = layer.textAlign || "center";
      ctx.textBaseline = "middle";
      lines.forEach((line, index) =>
        ctx.fillText(
          line,
          layer.textAlign === "left"
            ? -width / 2
            : layer.textAlign === "right"
              ? width / 2
              : 0,
          (index - (lines.length - 1) / 2) * fontSize * 1.08,
          width,
        ),
      );
    } else {
      ctx.scale(width / 1000, height / 600);
      ctx.translate(-500, -300);
      for (const stroke of layer.strokes || []) {
        if (stroke.points.length < 2) continue;
        ctx.globalAlpha = layer.opacity * (stroke.opacity ?? 1);
        ctx.beginPath();
        stroke.points.forEach((point, index) =>
          index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y),
        );
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png", 0.96),
  );
  if (!blob) throw new Error("Could not create the mockup PNG.");
  return blob;
}

function xml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] || character,
  );
}

function vectorLayerMarkup(layer: MockupVectorLayer) {
  const transform = `translate(${layer.x * 10} ${layer.y * 10}) rotate(${layer.rotation})`;
  if (layer.kind === "text") {
    const anchor =
      layer.textAlign === "left"
        ? "start"
        : layer.textAlign === "right"
          ? "end"
          : "middle";
    const x =
      layer.textAlign === "left"
        ? -layer.width * 5
        : layer.textAlign === "right"
          ? layer.width * 5
          : 0;
    const lines = (layer.text || "").split(/\r?\n/).slice(0, 10);
    const size = Math.max(8, (layer.height * 7) / Math.max(1, lines.length));
    return `<g transform="${transform}" opacity="${layer.opacity}"><text x="${x}" y="0" fill="${xml(layer.color || "#171717")}" font-family="${xml(layer.fontFamily || "Arial, sans-serif")}" font-size="${size}" font-weight="${layer.fontWeight || 700}" letter-spacing="${layer.letterSpacingEm || 0}em" text-anchor="${anchor}" dominant-baseline="middle">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? size * 1.08 : -(lines.length - 1) * size * 0.54}">${xml(line)}</tspan>`).join("")}</text></g>`;
  }
  const scaleX = (layer.width * 10) / 1000;
  const scaleY = (layer.height * 10) / 600;
  const paths = (layer.strokes || [])
    .map(
      (stroke) =>
        `<path d="${stroke.points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ")}" fill="none" stroke="${xml(stroke.color)}" stroke-opacity="${stroke.opacity ?? 1}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
  return `<g transform="${transform} scale(${scaleX} ${scaleY}) translate(-500 -300)" opacity="${layer.opacity}">${paths}</g>`;
}

type Props = {
  requestId: string;
  requestNumber: string;
  product: string;
};

export function MockupStudio({ requestId, requestNumber, product }: Props) {
  const [open, setOpen] = useState(false);
  const [documentState, setDocumentState] = useState<MockupDocument>(
    emptyMockupDocument(),
  );
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const stageRef = useRef<HTMLDivElement | null>(null);

  const activeView = useMemo(
    () =>
      documentState.views.find(
        (view) => view.id === documentState.activeViewId,
      ) || documentState.views[0],
    [documentState],
  );
  const selectedLayer =
    activeView?.layers.find((layer) => layer.id === selectedLayerId) || null;
  const customerIntent = activeView?.customerIntent || null;
  const productionDocument = useMemo(() => {
    const documents = documentState.designDocuments?.length
      ? documentState.designDocuments
      : documentState.designEngine
        ? [documentState.designEngine]
        : [];
    return (
      documents.find(
        (item) => item.product.id === activeView?.template?.productSlug,
      ) ||
      documents[0] ||
      null
    );
  }, [
    documentState.designDocuments,
    documentState.designEngine,
    activeView?.template?.productSlug,
  ]);
  const productionSurface =
    productionDocument?.surfaces.find(
      (surface) =>
        surface.id === (activeView?.template?.viewKey || activeView?.id),
    ) || null;
  const exportCount = documentState.views.filter(
    (view) => view.exportAsset?.path,
  ).length;
  const requestedViewCount = documentState.views.filter((view) =>
    Boolean(view.template?.orderItemId),
  ).length;
  const missingArtworkViews = useMemo(
    () => missingPreviewArtworkViews(documentState),
    [documentState],
  );
  const matchingVariantCount =
    activeView?.template?.productSlug && activeView.template.viewKey
      ? documentState.views.filter(
          (view) =>
            view.id !== activeView.id &&
            view.template?.productSlug === activeView.template?.productSlug &&
            view.template?.viewKey === activeView.template?.viewKey &&
            view.template?.designGroupId === activeView.template?.designGroupId,
        ).length
      : 0;

  async function loadProject() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/mockups?requestId=${encodeURIComponent(requestId)}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "MIGRATION_REQUIRED") setReady(false);
        throw new Error(result.error || "Could not load Mockup Studio.");
      }
      setReady(true);
      setDocumentState(result.document || emptyMockupDocument());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load Mockup Studio.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || ready !== null) return;
    void loadProject();
  }, [open, ready]);

  function updateView(
    viewId: string,
    updater: (view: MockupView) => MockupView,
  ) {
    setDocumentState((current) => ({
      ...current,
      views: current.views.map((view) =>
        view.id === viewId ? updater(view) : view,
      ),
    }));
  }

  function updateLayer(layerId: string, patch: Partial<MockupLayer>) {
    if (!activeView) return;
    updateView(activeView.id, (view) => ({
      ...view,
      exportAsset: null,
      layers: view.layers.map((layer) =>
        layer.id === layerId ? { ...layer, ...patch } : layer,
      ),
    }));
  }

  async function chooseBase(file: File | undefined) {
    if (!file || !activeView) return;
    setError("");
    setMessage("");
    try {
      const [uploaded] = await uploadFiles(requestId, `${activeView.id}-base`, [
        file,
      ]);
      updateView(activeView.id, (view) => ({
        ...view,
        base: uploaded,
        exportAsset: null,
      }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not upload the base image.",
      );
    }
  }

  async function addArtwork(files: FileList | null) {
    if (!activeView) return;
    const selected = Array.from(files ?? []).filter(
      (file) => file.type.startsWith("image/") || artworkCanPreview(file.name),
    );
    if (!selected.length) return;
    setError("");
    setMessage("");
    try {
      const assets = await uploadFiles(
        requestId,
        `${activeView.id}-artwork`,
        selected,
      );
      const maxZ = activeView.layers.reduce(
        (max, layer) => Math.max(max, layer.zIndex),
        0,
      );
      const layers = assets.map(
        (asset, index) =>
          ({
            id: uid("layer"),
            asset,
            x: 50,
            y: 50,
            width: 28,
            rotation: 0,
            opacity: 1,
            zIndex: maxZ + index + 1,
          }) satisfies MockupLayer,
      );
      updateView(activeView.id, (view) => ({
        ...view,
        layers: [...view.layers, ...layers],
        exportAsset: null,
      }));
      setSelectedLayerId(layers.at(-1)?.id || null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not upload artwork.",
      );
    }
  }

  function onLayerPointerDown(event: React.PointerEvent, layer: MockupLayer) {
    if (layer.locked || !stageRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedLayerId(layer.id);
    const stage = stageRef.current;
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);
    const move = (clientX: number, clientY: number) => {
      const rect = stage.getBoundingClientRect();
      updateLayer(layer.id, {
        x: clamp(((clientX - rect.left) / rect.width) * 100, -30, 130),
        y: clamp(((clientY - rect.top) / rect.height) * 100, -30, 130),
      });
    };
    move(event.clientX, event.clientY);
    const onMove = (e: PointerEvent) => move(e.clientX, e.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  async function save(status: "draft" | "proof_ready" = "draft") {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/mockups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          title: `${requestNumber} · ${product}`,
          status,
          document: cleanDocument(documentState),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not save mockups.");
      setReady(true);
      setMessage(result.message || "Mockup project saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save mockups.");
    } finally {
      setSaving(false);
    }
  }

  async function exportForProof() {
    if (missingArtworkViews.length) {
      setError(
        `Place the customer artwork on ${missingArtworkViews.map((view) => view.name).join(", ")} before exporting or sending this proof.`,
      );
      return;
    }
    setExporting(true);
    setError("");
    setMessage("");
    try {
      let nextDocument = documentState;
      for (const view of documentState.views) {
        if (!view.base?.url) continue;
        const blob = await renderView(view);
        const safeView =
          view.name
            .replace(/[^a-z0-9]+/gi, "-")
            .replace(/^-+|-+$/g, "")
            .toLowerCase() || "view";
        const file = new File(
          [blob],
          `${requestNumber}-${safeView}-mockup.png`,
          { type: "image/png" },
        );
        const [uploaded] = await uploadFiles(
          requestId,
          `mockup-${view.id}`,
          [file],
          PROOF_BUCKET,
        );
        nextDocument = {
          ...nextDocument,
          views: nextDocument.views.map((item) =>
            item.id === view.id ? { ...item, exportAsset: uploaded } : item,
          ),
        };
      }
      if (!nextDocument.views.some((view) => view.exportAsset?.path))
        throw new Error(
          "Add at least one product base image before exporting proof views.",
        );
      setDocumentState(nextDocument);
      const response = await fetch("/api/admin/mockups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          title: `${requestNumber} · ${product}`,
          status: "proof_ready",
          document: cleanDocument(nextDocument),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not save the exported mockups.");
      setMessage(
        "Proof views exported and attached to the Proof + Quote workspace.",
      );
      window.dispatchEvent(
        new CustomEvent("moore-made-mockup-exported", {
          detail: { requestId },
        }),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not export proof views.",
      );
    } finally {
      setExporting(false);
    }
  }

  function addView() {
    const id = uid("view");
    setDocumentState((current) => ({
      ...current,
      activeViewId: id,
      views: [
        ...current.views,
        {
          id,
          name: `View ${current.views.length + 1}`,
          base: null,
          layers: [],
        },
      ],
    }));
    setSelectedLayerId(null);
  }

  function copyArtworkToMatchingVariants() {
    if (
      !activeView?.template?.productSlug ||
      !activeView.template.viewKey ||
      !matchingVariantCount
    )
      return;
    if (!activeView.layers.length) {
      setError(
        "Add or recover artwork on this view before copying it to the matching colors.",
      );
      return;
    }
    setError("");
    setDocumentState((current) => ({
      ...current,
      views: current.views.map((view) => {
        const matches =
          view.id !== activeView.id &&
          view.template?.productSlug === activeView.template?.productSlug &&
          view.template?.viewKey === activeView.template?.viewKey &&
          view.template?.designGroupId === activeView.template?.designGroupId;
        if (!matches) return view;
        return {
          ...view,
          layers: activeView.layers.map((layer, index) => ({
            ...layer,
            id: `${view.id}-copied-layer-${index + 1}`,
          })),
          vectorLayers: (activeView.vectorLayers || []).map((layer, index) => ({
            ...layer,
            id: `${view.id}-copied-vector-${index + 1}`,
          })),
          exportAsset: null,
        };
      }),
    }));
    setMessage(
      `Artwork copied to ${matchingVariantCount} matching ${activeView.template.viewKey} view${matchingVariantCount === 1 ? "" : "s"}. Save the mockup changes when everything looks right.`,
    );
  }

  function downloadCustomerVectorSvg() {
    if (!activeView?.vectorLayers?.length) return;
    const body = activeView.vectorLayers
      .slice()
      .sort((a, b) => a.zIndex - b.zIndex)
      .map(vectorLayerMarkup)
      .join("");
    const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">${body}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${requestNumber}-${activeView.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "design"}-customer-vector.svg`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="mockupStudio">
      <button
        className="mockupStudioToggle"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          <strong>Mockup Studio</strong>
          <small>
            {exportCount
              ? `${exportCount} proof view${exportCount === 1 ? "" : "s"} ready`
              : "Build front/back product previews without leaving Moore Made"}
          </small>
        </span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="mockupStudioBody">
          {loading ? (
            <div className="mockupLoading">Loading Mockup Studio…</div>
          ) : ready === false ? (
            <div className="requestWarning">
              <strong>Mockup Studio needs one database update.</strong>
              <br />
              Run <code>supabase/moore_made_phase6_22_mockup_studio.sql</code>,
              then refresh this order.
            </div>
          ) : (
            <>
              <div className="mockupStudioIntro">
                <div>
                  <span className="eyebrow">Admin design workspace</span>
                  <h5>
                    {requestNumber} · {product}
                  </h5>
                  <p>
                    {requestedViewCount
                      ? `${requestedViewCount} requested product/color/side mockups are loaded below. Edit each view, then save once and attach the saved set in Proof + Quote.`
                      : "Edit the customer’s placement, add a printable preview when needed, then save once. Proof + Quote can attach the complete saved set directly."}
                  </p>
                </div>
                <div className="mockupStudioTopActions">
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={saving}
                    onClick={() => save("draft")}
                  >
                    {saving ? "Saving…" : "Save all mockups"}
                  </button>
                  {activeView?.vectorLayers?.length ? (
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={downloadCustomerVectorSvg}
                    >
                      Download customer SVG
                    </button>
                  ) : null}
                  <button
                    className="btn"
                    type="button"
                    disabled={exporting || saving}
                    onClick={exportForProof}
                  >
                    {exporting ? "Rendering…" : "Export PNGs (optional)"}
                  </button>
                </div>
              </div>
              {missingArtworkViews.length ? (
                <div className="mockupArtworkRequired">
                  <strong>Artwork still needs to be placed</strong>
                  <span>
                    {missingArtworkViews
                      .map(
                        (view) =>
                          `${view.name}${view.customerIntent?.artworkFileName ? ` · ${view.customerIntent.artworkFileName}` : ""}`,
                      )
                      .join("; ")}
                  </span>
                  <small>
                    Open each listed view, add or recover the customer file as
                    preview artwork, then position it. This saved mockup cannot
                    be used as a proof until it is visible.
                  </small>
                </div>
              ) : null}

              <div className="mockupViewTabs">
                {documentState.views.map((view) => (
                  <button
                    type="button"
                    key={view.id}
                    className={view.id === activeView?.id ? "active" : ""}
                    onClick={() => {
                      setDocumentState((current) => ({
                        ...current,
                        activeViewId: view.id,
                      }));
                      setSelectedLayerId(null);
                    }}
                  >
                    <span>{view.name}</span>
                    {view.exportAsset?.path ? (
                      <small>Proof ready ✓</small>
                    ) : (
                      <small>
                        {view.template?.quantity
                          ? `${view.template.quantity} pc${view.template.quantity === 1 ? "" : "s"} · `
                          : ""}
                        {view.customerIntent?.source === "idea"
                          ? "design needed"
                          : view.customerIntent?.backgroundRemovalRequested
                            ? "background removal"
                            : view.layers.length
                              ? "artwork loaded"
                              : "artwork file needs preview"}
                      </small>
                    )}
                  </button>
                ))}
                <button
                  className="mockupAddView"
                  type="button"
                  onClick={addView}
                >
                  + Custom view
                </button>
              </div>

              {activeView ? (
                <div className="mockupWorkspace">
                  <aside className="mockupToolsPanel">
                    <div className="mockupViewIdentity">
                      <label className="field">
                        <span>View name</span>
                        <input
                          value={activeView.name}
                          maxLength={100}
                          onChange={(e) =>
                            updateView(activeView.id, (view) => ({
                              ...view,
                              name: e.target.value,
                              exportAsset: null,
                            }))
                          }
                        />
                      </label>
                      {activeView.template?.quantity ? (
                        <span className="mockupQuantityBadge">
                          {activeView.template.quantity} piece
                          {activeView.template.quantity === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                    {customerIntent ? (
                      <div
                        className={`mockupCustomerDirection ${customerIntent.enabled ? "isEnabled" : "isDisabled"}`}
                      >
                        <div>
                          <strong>Customer direction</strong>
                          <span>
                            {customerIntent.enabled
                              ? `${customerIntent.placementLabel || customerIntent.placement} · ${customerIntent.source === "idea" ? "needs design" : customerIntent.source === "upload" ? "customer artwork" : customerIntent.source === "text" ? "editable customer text" : customerIntent.source === "drawing" ? "customer drawing" : customerIntent.source === "mixed" ? "mixed customer design" : "example only"}`
                              : "Customer did not request this side"}
                          </span>
                        </div>
                        {customerIntent.idea ? (
                          <p>{customerIntent.idea}</p>
                        ) : null}
                        {customerIntent.details ? (
                          <p>{customerIntent.details}</p>
                        ) : null}
                        {customerIntent.artworkFileName ? (
                          <small>
                            Original: {customerIntent.artworkFileName}
                          </small>
                        ) : null}
                        {activeView.template?.designRelationship ===
                        "separate" ? (
                          <small className="mockupSeparateDesignNote">
                            Different design requested
                            {activeView.template.orderItemNotes
                              ? ` · ${activeView.template.orderItemNotes}`
                              : ""}
                          </small>
                        ) : null}
                        {customerIntent.backgroundRemovalRequested ? (
                          <div className="mockupBackgroundRemovalAlert">
                            <strong>Transparent background requested</strong>
                            <span>
                              Remove the uploaded background. Use vector
                              redraw/vectorization when needed, include the
                              preparation charge in the quote, and send the
                              finished proof for approval.
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {productionSurface ? (
                      <section className="adminProductionManifest">
                        <div className="adminProductionManifestHead">
                          <div>
                            <strong>Production assets</strong>
                            <span>
                              Editable source data — never the proof screenshot
                            </span>
                          </div>
                          <b>
                            {productionDocument?.product.mockupType.toUpperCase()}
                          </b>
                        </div>
                        <div className="adminProductionFacts">
                          <span>
                            <small>Print area</small>
                            <strong>
                              {productionSurface.physicalSizeIn.width} ×{" "}
                              {productionSurface.physicalSizeIn.height} in
                            </strong>
                          </span>
                          <span>
                            <small>Placement</small>
                            <strong>
                              {customerIntent?.placementLabel ||
                                customerIntent?.placement ||
                                "Custom"}
                            </strong>
                          </span>
                          <span>
                            <small>Coordinates</small>
                            <strong>
                              {customerIntent
                                ? `${customerIntent.x.toFixed(1)}%, ${customerIntent.y.toFixed(1)}%`
                                : "—"}
                            </strong>
                          </span>
                          <span>
                            <small>Rotation</small>
                            <strong>
                              {customerIntent
                                ? `${customerIntent.rotation.toFixed(1)}°`
                                : "—"}
                            </strong>
                          </span>
                        </div>
                        {productionSurface.layers.map((layer) => (
                          <article
                            key={layer.id}
                            className={`adminProductionLayer is-${layer.kind}`}
                          >
                            <div>
                              <strong>{layer.name}</strong>
                              <span>
                                {layer.kind === "image"
                                  ? `${layer.originalPixels?.width || 0} × ${layer.originalPixels?.height || 0}px original`
                                  : layer.kind === "text"
                                    ? `${layer.fontLabel} · ${layer.fontSizePt}pt · ${layer.color}`
                                    : `${layer.strokes.length} editable stroke${layer.strokes.length === 1 ? "" : "s"}`}
                              </span>
                            </div>
                            <div>
                              <strong>
                                {layer.intendedWidthIn.toFixed(1)} ×{" "}
                                {layer.intendedHeightIn.toFixed(1)} in
                              </strong>
                              <span>
                                {layer.kind === "image"
                                  ? `${layer.quality.message}${layer.quality.effectivePpi ? ` · ${layer.quality.effectivePpi} PPI` : ""}`
                                  : "Vector/editable production data"}
                              </span>
                            </div>
                            {layer.kind === "image" &&
                            layer.improvementRequests.length ? (
                              <ul>
                                {layer.improvementRequests.map((request) => (
                                  <li key={request}>
                                    {request === "remove-background"
                                      ? "Remove Background"
                                      : request === "improve-artwork"
                                        ? "Improve Artwork"
                                        : "Recreate / Vectorize if Appropriate"}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            {layer.kind === "image" &&
                            activeView.layers.find(
                              (item) => item.asset.path === layer.source.path,
                            )?.asset.url ? (
                              <a
                                href={
                                  activeView.layers.find(
                                    (item) =>
                                      item.asset.path === layer.source.path,
                                  )!.asset.url!
                                }
                                target="_blank"
                                rel="noreferrer"
                                download
                              >
                                Download original artwork ↗
                              </a>
                            ) : null}
                          </article>
                        ))}
                      </section>
                    ) : null}
                    <details className="mockupCompactTools">
                      <summary>Product image & artwork files</summary>
                      <div className="mockupToolBlock">
                        <div>
                          <strong>Product preview</strong>
                          <small>
                            {activeView.template?.colorName
                              ? `${activeView.template.productName || product} · ${activeView.template.colorName}`
                              : "Front/back photo or blank mockup"}
                          </small>
                        </div>
                        {!activeView.base &&
                        previewKind(activeView.template?.previewKind) ? (
                          <small className="mockupFileName">
                            Using the Shop product preview. A real blank photo
                            is optional.
                          </small>
                        ) : null}
                        <label className="btn secondary mockupUploadButton">
                          {activeView.base
                            ? "Replace base image"
                            : "Use a real blank photo"}
                          <input
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={(e) => {
                              void chooseBase(e.target.files?.[0]);
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                        {activeView.base ? (
                          <small className="mockupFileName">
                            {activeView.base.originalName}
                          </small>
                        ) : null}
                      </div>
                      <div className="mockupToolBlock">
                        <div>
                          <strong>Printable preview artwork</strong>
                          <small>
                            PNG, SVG, JPG, or WebP can display on the mockup.
                          </small>
                        </div>
                        <label className="btn secondary mockupUploadButton">
                          + Add preview artwork
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
                            multiple
                            hidden
                            onChange={(e) => {
                              void addArtwork(e.target.files);
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                      </div>
                    </details>

                    <div className="mockupLayerList">
                      <strong>Artwork layers</strong>
                      {activeView.layers.length ? (
                        activeView.layers
                          .slice()
                          .sort((a, b) => b.zIndex - a.zIndex)
                          .map((layer) => (
                            <button
                              type="button"
                              key={layer.id}
                              className={
                                selectedLayerId === layer.id ? "active" : ""
                              }
                              onClick={() => setSelectedLayerId(layer.id)}
                            >
                              <span>{layer.asset.originalName}</span>
                              <small>
                                {artworkCanPreview(layer.asset.originalName)
                                  ? `${Math.round(layer.width)}% wide`
                                  : "original saved · preview needed"}
                              </small>
                            </button>
                          ))
                      ) : (
                        <p>No preview artwork attached yet.</p>
                      )}
                    </div>
                    {activeView.vectorLayers?.length ? (
                      <div className="mockupVectorSummary">
                        <div>
                          <strong>Customer vector elements</strong>
                          <span>
                            These remain crisp and are included in proof
                            exports.
                          </span>
                        </div>
                        {activeView.vectorLayers.map((layer) => (
                          <article key={layer.id}>
                            <strong>
                              {layer.kind === "text"
                                ? layer.text || "Text"
                                : "Customer drawing"}
                            </strong>
                            <small>
                              {layer.kind === "text"
                                ? `${layer.fontLabel || "Saved font"} · ${layer.color}`
                                : `${layer.strokes?.length || 0} stroke${layer.strokes?.length === 1 ? "" : "s"}`}
                            </small>
                          </article>
                        ))}
                        <button
                          type="button"
                          onClick={downloadCustomerVectorSvg}
                        >
                          Download this view as SVG
                        </button>
                      </div>
                    ) : null}

                    {selectedLayer ? (
                      <div className="mockupLayerControls">
                        <div className="mockupControlHeading">
                          <strong>Selected artwork</strong>
                          <button
                            type="button"
                            className="textButton dangerText"
                            onClick={() => {
                              updateView(activeView.id, (view) => ({
                                ...view,
                                layers: view.layers.filter(
                                  (layer) => layer.id !== selectedLayer.id,
                                ),
                                exportAsset: null,
                              }));
                              setSelectedLayerId(null);
                            }}
                          >
                            Remove
                          </button>
                        </div>
                        {!artworkCanPreview(
                          selectedLayer.asset.originalName,
                        ) ? (
                          <div className="mockupUnsupportedArtwork">
                            <strong>
                              This original cannot render in a browser.
                            </strong>
                            <span>
                              Download it for editing, then add a PNG or SVG
                              preview above. The original remains attached to
                              the order.
                            </span>
                            {selectedLayer.asset.url ? (
                              <a
                                href={selectedLayer.asset.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Download {selectedLayer.asset.originalName} ↗
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                        <label>
                          <span>
                            Size <b>{Math.round(selectedLayer.width)}%</b>
                          </span>
                          <input
                            type="range"
                            min="3"
                            max="150"
                            step="1"
                            value={selectedLayer.width}
                            onChange={(e) => {
                              updateLayer(selectedLayer.id, {
                                width: Number(e.target.value),
                              });
                            }}
                          />
                        </label>
                        <label>
                          <span>
                            Rotation{" "}
                            <b>{Math.round(selectedLayer.rotation)}°</b>
                          </span>
                          <input
                            type="range"
                            min="-180"
                            max="180"
                            step="1"
                            value={selectedLayer.rotation}
                            onChange={(e) => {
                              updateLayer(selectedLayer.id, {
                                rotation: Number(e.target.value),
                              });
                            }}
                          />
                        </label>
                        <label>
                          <span>
                            Opacity{" "}
                            <b>{Math.round(selectedLayer.opacity * 100)}%</b>
                          </span>
                          <input
                            type="range"
                            min="10"
                            max="100"
                            step="1"
                            value={selectedLayer.opacity * 100}
                            onChange={(e) => {
                              updateLayer(selectedLayer.id, {
                                opacity: Number(e.target.value) / 100,
                              });
                            }}
                          />
                        </label>
                        <div className="mockupNudges">
                          <button
                            type="button"
                            onClick={() =>
                              updateLayer(selectedLayer.id, {
                                x: selectedLayer.x - 1,
                              })
                            }
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateLayer(selectedLayer.id, {
                                y: selectedLayer.y - 1,
                              })
                            }
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateLayer(selectedLayer.id, {
                                y: selectedLayer.y + 1,
                              })
                            }
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateLayer(selectedLayer.id, {
                                x: selectedLayer.x + 1,
                              })
                            }
                          >
                            →
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateLayer(selectedLayer.id, { x: 50, y: 50 })
                            }
                          >
                            Center
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {matchingVariantCount ? (
                      <button
                        className="btn secondary mockupCopyVariants"
                        type="button"
                        onClick={copyArtworkToMatchingVariants}
                      >
                        Apply artwork to {matchingVariantCount} matching color
                        view{matchingVariantCount === 1 ? "" : "s"}
                      </button>
                    ) : null}
                  </aside>

                  <div className="mockupCanvasColumn">
                    <div className="mockupCanvasHead">
                      <div>
                        <strong>{activeView.name} preview</strong>
                        <small>
                          Drag artwork directly on the product. Sliders give you
                          precise size/rotation control.
                        </small>
                      </div>
                      {activeView.exportAsset?.path ? (
                        <span>Proof export ready ✓</span>
                      ) : (
                        <span>Draft</span>
                      )}
                    </div>
                    <div
                      className={`mockupStage ${activeView.base ? "hasBase" : ""}`}
                      ref={stageRef}
                      onPointerDown={() => setSelectedLayerId(null)}
                    >
                      {activeView.base?.url ? (
                        <img
                          className="mockupBaseImage"
                          src={activeView.base.url}
                          alt={`${activeView.name} product base`}
                          draggable={false}
                        />
                      ) : previewKind(activeView.template?.previewKind) ? (
                        <ProductVisual
                          kind={previewKind(activeView.template?.previewKind)!}
                          view={
                            activeView.template?.viewKey === "back"
                              ? "back"
                              : "front"
                          }
                          label={
                            activeView.template?.viewKey === "back"
                              ? "BACK"
                              : "FRONT"
                          }
                          color={activeView.template?.colorValue || "#f4f2ed"}
                          className="mockupCatalogBaseVisual"
                        />
                      ) : (
                        <div className="mockupEmptyCanvas">
                          <strong>
                            {documentState.source === "customer"
                              ? "Customer placement loaded"
                              : `Upload a ${activeView.name.toLowerCase()} product image`}
                          </strong>
                          <p>
                            {documentState.source === "customer"
                              ? "The customer&apos;s placement is saved. Add a real blank photo only if you want a flattened PNG proof."
                              : "Use the same type of blank/mockup image you currently bring into Canva."}
                          </p>
                        </div>
                      )}
                      {customerIntent?.enabled && customerIntent.idea ? (
                        <div
                          className="mockupCustomerIdeaLayer"
                          style={{
                            left: `${customerIntent.x}%`,
                            top: `${customerIntent.y}%`,
                            width: `${customerIntent.width}%`,
                            transform: `translate(-50%, -50%) rotate(${customerIntent.rotation}deg)`,
                          }}
                        >
                          <strong>DESIGN NEEDED</strong>
                          <span>
                            {customerIntent.placementLabel ||
                              customerIntent.placement}
                          </span>
                        </div>
                      ) : null}
                      {activeView.layers.map((layer) =>
                        layer.asset.url ? (
                          <div
                            key={layer.id}
                            className={`mockupLayer ${selectedLayerId === layer.id ? "selected" : ""} ${artworkCanPreview(layer.asset.originalName) ? "" : "isUnsupported"}`}
                            style={{
                              left: `${layer.x}%`,
                              top: `${layer.y}%`,
                              width: `${layer.width}%`,
                              zIndex: layer.zIndex,
                              opacity: layer.opacity,
                              transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
                            }}
                            onPointerDown={(event) =>
                              onLayerPointerDown(event, layer)
                            }
                          >
                            {artworkCanPreview(layer.asset.originalName) ? (
                              <img
                                src={layer.asset.url}
                                alt={layer.asset.originalName}
                                draggable={false}
                              />
                            ) : (
                              <div className="mockupLayerFilePlaceholder">
                                <strong>PREVIEW FILE NEEDED</strong>
                                <span>{layer.asset.originalName}</span>
                              </div>
                            )}
                          </div>
                        ) : null,
                      )}
                      {(activeView.vectorLayers || []).map((layer) => (
                        <div
                          key={layer.id}
                          className={`mockupLayer mockupVectorLayer is-${layer.kind}`}
                          style={{
                            left: `${layer.x}%`,
                            top: `${layer.y}%`,
                            width: `${layer.width}%`,
                            height: `${layer.height}%`,
                            zIndex: layer.zIndex,
                            opacity: layer.opacity,
                            transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
                          }}
                        >
                          {layer.kind === "text" ? (
                            <div
                              className="customerTextArtwork"
                              style={{
                                color: layer.color,
                                fontFamily: layer.fontFamily,
                                fontWeight: layer.fontWeight,
                                textAlign: layer.textAlign,
                                letterSpacing: `${layer.letterSpacingEm || 0}em`,
                              }}
                            >
                              {layer.text}
                            </div>
                          ) : (
                            <svg
                              className="customerDrawingArtwork"
                              viewBox="0 0 1000 600"
                              preserveAspectRatio="none"
                            >
                              {(layer.strokes || []).map((stroke, index) => (
                                <path
                                  key={index}
                                  d={stroke.points
                                    .map(
                                      (point, pointIndex) =>
                                        `${pointIndex ? "L" : "M"}${point.x} ${point.y}`,
                                    )
                                    .join(" ")}
                                  fill="none"
                                  stroke={stroke.color}
                                  strokeOpacity={stroke.opacity ?? 1}
                                  strokeWidth={stroke.width}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              ))}
                            </svg>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mockupCanvasFoot">
                      <span>
                        Save your changes to update the working mockup. When you
                        send a quote, Moore Made freezes a copy of the exact
                        mockup the customer is approving.
                      </span>
                      {activeView.exportAsset?.url ? (
                        <a
                          href={activeView.exportAsset.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open latest exported PNG ↗
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {error ? <div className="formError">{error}</div> : null}
              {message ? <div className="formSuccess">{message}</div> : null}
              <div className="mockupFutureNote">
                <strong>
                  {documentState.source === "customer"
                    ? "Started by the customer in Shop."
                    : "Shared mockup engine."}
                </strong>
                <span>
                  {documentState.source === "customer"
                    ? "Their uploaded art, placement, size, rotation, and design-needed notes are preserved here. Refine the layout and save it; Quote Builder can attach the current mockup without making you recreate it."
                    : "Product templates, editable placement, client artwork, and frozen approval snapshots use the same project format on both sides."}
                </span>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
