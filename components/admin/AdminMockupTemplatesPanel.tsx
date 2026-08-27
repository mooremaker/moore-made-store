"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { findProductColor, products } from "@/lib/catalog";
import {
  catalogSettingsFromTemplateDocument,
  defaultCatalogMockupSettings,
  type CatalogMockupSettings,
  type ProductMockupTemplateRecord,
} from "@/lib/mockup-template-types";
import { ProductVisual } from "@/components/shop/ProductVisual";

type Layer = "product" | "logo";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rounded(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function AdminMockupTemplatesPanel() {
  const [productKey, setProductKey] = useState(products[0]?.slug ?? "");
  const product = useMemo(() => products.find((item) => item.slug === productKey) ?? products[0], [productKey]);
  const [colorName, setColorName] = useState(product?.colors[0]?.name ?? "Default");
  const [templates, setTemplates] = useState<ProductMockupTemplateRecord[]>([]);
  const [settings, setSettings] = useState<CatalogMockupSettings>(() => product ? defaultCatalogMockupSettings(product) : {
    ...defaultCatalogMockupSettings(products[0]!), productX: 50, productY: 50, productScale: 1, productRotation: 0, logoX: 50, logoY: 50, logoWidth: 30, logoRotation: 0,
  });
  const [selectedLayer, setSelectedLayer] = useState<Layer>("logo");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const stageRef = useRef<HTMLDivElement | null>(null);

  const selectedColor = findProductColor(product, colorName);
  const savedTemplate = useMemo(
    () => templates.find((item) => item.product_key === product?.slug && item.visibility === "shop" && item.is_active),
    [templates, product?.slug],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/admin/mockup-templates", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Could not load mockup templates.");
        if (!cancelled) setTemplates(payload.templates ?? []);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load mockup templates.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!product) return;
    setColorName(product.colors[0]?.name ?? "Default");
    const template = templates.find((item) => item.product_key === product.slug && item.visibility === "shop" && item.is_active);
    setSettings(template ? catalogSettingsFromTemplateDocument(product, template.template_document) : defaultCatalogMockupSettings(product));
    setMessage("");
    setError("");
  }, [product, templates]);

  function patch(next: Partial<CatalogMockupSettings>) {
    setSettings((current) => ({ ...current, ...next }));
    setMessage("");
  }

  function beginMove(layer: Layer, event: React.PointerEvent<HTMLDivElement>) {
    if (!stageRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedLayer(layer);
    const stage = stageRef.current;

    const move = (clientX: number, clientY: number) => {
      const rect = stage.getBoundingClientRect();
      const x = clamp(((clientX - rect.left) / rect.width) * 100, -25, 125);
      const y = clamp(((clientY - rect.top) / rect.height) * 100, -25, 125);
      if (layer === "product") patch({ productX: rounded(x), productY: rounded(y) });
      else patch({ logoX: rounded(x), logoY: rounded(y) });
    };

    move(event.clientX, event.clientY);
    const onMove = (pointerEvent: PointerEvent) => move(pointerEvent.clientX, pointerEvent.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function beginLogoResize(event: React.PointerEvent<HTMLButtonElement>) {
    if (!stageRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedLayer("logo");
    const rect = stageRef.current.getBoundingClientRect();
    const startX = event.clientX;
    const startWidth = settings.logoWidth;
    const onMove = (pointerEvent: PointerEvent) => {
      const deltaPercent = ((pointerEvent.clientX - startX) / rect.width) * 100;
      patch({ logoWidth: rounded(clamp(startWidth + deltaPercent * 2, 4, 120)) });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function resetAll() {
    if (!product) return;
    setSettings(defaultCatalogMockupSettings(product));
    setMessage("");
  }

  async function save() {
    if (!product) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/mockup-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productKey: product.slug, settings }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save the mockup default.");
      const saved = payload.template as ProductMockupTemplateRecord;
      setTemplates((current) => [saved, ...current.filter((item) => item.id !== saved.id && item.product_key !== product.slug)]);
      setMessage(`Saved ${product.name}. New shop previews and customer customizers will use this default.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the mockup default.");
    } finally {
      setSaving(false);
    }
  }

  if (!product) return null;

  return (
    <section className="adminWorkspacePanel mockupTemplatePanel">
      <div className="adminSectionIntro mockupTemplateIntro">
        <div>
          <div className="eyebrow">Mockup defaults</div>
          <h2>Move the product and logo yourself.</h2>
          <p>Drag either layer directly in the preview, resize the logo with its corner handle, and save the result. The saved default is reused on the Shop and as the starting point in the customer customizer.</p>
        </div>
        <div className="mockupTemplateSaveState">
          <span>{savedTemplate ? `Saved ${new Date(savedTemplate.updated_at).toLocaleDateString()}` : "Using code default"}</span>
          <button className="btn" type="button" onClick={save} disabled={saving || loading}>{saving ? "Saving…" : "Save default"}</button>
        </div>
      </div>

      {error ? <div className="formError">{error}</div> : null}
      {message ? <div className="formSuccess">{message}</div> : null}

      <div className="mockupTemplateTopControls">
        <label className="field">
          <span>Product</span>
          <select value={product.slug} onChange={(event) => setProductKey(event.target.value)}>
            {products.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Customer mockup</span>
          <select value={settings.designEngine.mockupType} onChange={(event) => patch({ designEngine: { ...settings.designEngine, mockupType: event.target.value as "2d" | "3d" } })}>
            <option value="2d">2D blank</option>
            {settings.designEngine.allowedMockupTypes.includes("3d") ? <option value="3d">3D interactive</option> : null}
          </select>
          <small>{settings.designEngine.allowedMockupTypes.includes("3d") ? "Uses the starter 3D model until a production GLB is assigned." : "This product stays on the existing 2D renderer."}</small>
        </label>
        <label className="field">
          <span>Preview color</span>
          <select value={colorName} onChange={(event) => setColorName(event.target.value)}>
            {product.colors.map((color) => <option key={color.name} value={color.name}>{color.name}</option>)}
          </select>
        </label>
        <div className="mockupTemplateLayerButtons">
          <span>Edit layer</span>
          <div>
            <button type="button" className={selectedLayer === "product" ? "active" : ""} onClick={() => setSelectedLayer("product")}>Product blank</button>
            <button type="button" className={selectedLayer === "logo" ? "active" : ""} onClick={() => setSelectedLayer("logo")}>Example logo</button>
          </div>
        </div>
      </div>

      <div className="mockupTemplateWorkspace">
        <div className="mockupTemplatePreviewColumn">
          <div className="mockupTemplatePreviewHead">
            <div><strong>Live shop preview</strong><span>Drag {selectedLayer === "logo" ? "the logo" : "the blank product"} directly.</span></div>
            <span className="mockupTemplateSelectedBadge">Editing: {selectedLayer === "logo" ? "Logo" : "Product"}</span>
          </div>
          <div className="mockupTemplateStageWrap">
            <ProductVisual
              rootRef={stageRef}
              kind={product.previewKind}
              color={selectedColor?.value ?? "#e6e0d8"}
              example
              label="Admin preview"
              mockupSettings={settings}
              editable
              selectedLayer={selectedLayer}
              onProductPointerDown={(event) => beginMove("product", event)}
              onLogoPointerDown={(event) => beginMove("logo", event)}
              onLogoResizePointerDown={beginLogoResize}
              className="mockupTemplateVisual"
            />
            <div className="mockupTemplateSafeArea" aria-hidden="true"><span>visual guide</span></div>
          </div>
          <div className="mockupTemplateQuickActions">
            <button type="button" onClick={() => patch({ productX: 50, productY: 50 })}>Center product</button>
            <button type="button" onClick={() => patch({ logoX: 50, logoY: 50 })}>Center logo</button>
            <button type="button" onClick={() => patch({ productX: 50, productY: 50, productScale: 1, productRotation: 0 })}>Fit product</button>
            <button type="button" onClick={resetAll}>Reset all</button>
          </div>
        </div>

        <aside className="mockupTemplateControls">
          <section className={selectedLayer === "product" ? "active" : ""} onClick={() => setSelectedLayer("product")}>
            <div className="mockupTemplateControlHead"><div><strong>Product blank</strong><span>Move and zoom the shirt, mug, tote, card, etc.</span></div><b>{Math.round(settings.productScale * 100)}%</b></div>
            <label><span>Scale</span><input type="range" min="35" max="220" step="1" value={Math.round(settings.productScale * 100)} onChange={(event) => patch({ productScale: Number(event.target.value) / 100 })} /></label>
            <div className="mockupTemplateNumberGrid">
              <label><span>X</span><input type="number" step="1" value={rounded(settings.productX)} onChange={(event) => patch({ productX: clamp(Number(event.target.value), -50, 150) })} /></label>
              <label><span>Y</span><input type="number" step="1" value={rounded(settings.productY)} onChange={(event) => patch({ productY: clamp(Number(event.target.value), -50, 150) })} /></label>
            </div>
            <label><span>Rotation <b>{rounded(settings.productRotation)}°</b></span><input type="range" min="-45" max="45" step="1" value={settings.productRotation} onChange={(event) => patch({ productRotation: Number(event.target.value) })} /></label>
          </section>

          <section className={selectedLayer === "logo" ? "active" : ""} onClick={() => setSelectedLayer("logo")}>
            <div className="mockupTemplateControlHead"><div><strong>Example logo</strong><span>Drag it, use the corner handle, or fine-tune it here.</span></div><b>{Math.round(settings.logoWidth)}%</b></div>
            <label><span>Logo size</span><input type="range" min="4" max="100" step="1" value={settings.logoWidth} onChange={(event) => patch({ logoWidth: Number(event.target.value) })} /></label>
            <div className="mockupTemplateNumberGrid">
              <label><span>X</span><input type="number" step="1" value={rounded(settings.logoX)} onChange={(event) => patch({ logoX: clamp(Number(event.target.value), -50, 150) })} /></label>
              <label><span>Y</span><input type="number" step="1" value={rounded(settings.logoY)} onChange={(event) => patch({ logoY: clamp(Number(event.target.value), -50, 150) })} /></label>
            </div>
            <label><span>Rotation <b>{rounded(settings.logoRotation)}°</b></span><input type="range" min="-180" max="180" step="1" value={settings.logoRotation} onChange={(event) => patch({ logoRotation: Number(event.target.value) })} /></label>
          </section>

          <div className="mockupTemplateTip">
            <strong>How this works</strong>
            <p>These are defaults only. They do not alter old approved customer proofs. Customers can still move and resize their own uploaded artwork after they start customizing.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
