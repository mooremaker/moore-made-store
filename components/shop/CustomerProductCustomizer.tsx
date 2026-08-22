"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { Product, PlacementOption } from "@/lib/catalog";
import type { CatalogMockupSettings } from "@/lib/mockup-template-types";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { compactSizeSummary, orderItemQuantity, orderItemsQuantity, type ShippingAddress, type StructuredOrderItem } from "@/lib/order-types";
import { ProductVisual } from "@/components/shop/ProductVisual";
import { makeStructuredOrderItem, OrderItemsBuilder } from "@/components/shop/OrderItemsBuilder";

const BUCKET = "custom-request-files";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

type ViewKey = "front" | "back";
type ArtworkMode = "example" | "upload" | "idea";
type Coverage = "front" | "back" | "front-back";
type RequestStep = 1 | 2 | 3 | 4;

type ViewState = {
  mode: ArtworkMode;
  placement: string;
  idea: string;
  file: File | null;
  previewUrl: string | null;
  previewable: boolean;
  x: number;
  y: number;
  width: number;
  rotation: number;
};

type SuccessState = {
  requestNumber: number | string;
  uploadWarning: boolean;
  mockupWarning: boolean;
  emailWarning: boolean;
};

const blankAddress: ShippingAddress = {
  name: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isPreviewableImage(file: File) {
  return file.type.startsWith("image/") || /\.svg$/i.test(file.name);
}

function placementFor(product: Product, view: ViewKey, value?: string): PlacementOption {
  const options = product.placements[view];
  return options.find((item) => item.value === value) ?? options[0] ?? { value: "custom", label: "Custom placement", x: 50, y: 50, width: 35 };
}

function initialView(product: Product, view: ViewKey, mockupSettings?: CatalogMockupSettings): ViewState {
  const placement = placementFor(product, view, product.defaultPlacements?.[view]);
  const useSavedFrontDefault = view === "front" && Boolean(mockupSettings);
  return {
    mode: "example",
    placement: placement.value,
    idea: "",
    file: null,
    previewUrl: null,
    previewable: false,
    x: useSavedFrontDefault ? mockupSettings!.logoX : placement.x,
    y: useSavedFrontDefault ? mockupSettings!.logoY : placement.y,
    width: useSavedFrontDefault ? mockupSettings!.logoWidth : placement.width,
    rotation: useSavedFrontDefault ? mockupSettings!.logoRotation : 0,
  };
}

function coverageLabel(product: Product, coverage: Coverage) {
  if (!product.supportsBack || coverage === "front") return `${product.viewLabels.front} only`;
  if (coverage === "back") return `${product.viewLabels.back} only`;
  return `${product.viewLabels.front} + ${product.viewLabels.back}`;
}

function activeViews(product: Product, coverage: Coverage): ViewKey[] {
  if (!product.supportsBack) return ["front"];
  if (coverage === "front") return ["front"];
  if (coverage === "back") return ["back"];
  return ["front", "back"];
}

function displayFileName(file: File | null) {
  if (!file) return "";
  return file.name.length > 38 ? `${file.name.slice(0, 34)}…` : file.name;
}

function stepLabel(step: RequestStep) {
  if (step === 1) return "Design";
  if (step === 2) return "Quantities";
  if (step === 3) return "Contact & delivery";
  return "Review";
}

export function CustomerProductCustomizer({
  product,
  initialName = "",
  initialEmail = "",
  initialPhone = "",
  mockupSettings,
}: {
  product: Product;
  initialName?: string;
  initialEmail?: string;
  initialPhone?: string;
  mockupSettings?: CatalogMockupSettings;
}) {
  const [requestStep, setRequestStep] = useState<RequestStep>(1);
  const [coverage, setCoverage] = useState<Coverage>("front");
  const [activeView, setActiveView] = useState<ViewKey>("front");
  const [customItemType, setCustomItemType] = useState("");
  const [customColorNotes, setCustomColorNotes] = useState("");
  const [front, setFront] = useState<ViewState>(() => initialView(product, "front", mockupSettings));
  const [back, setBack] = useState<ViewState>(() => initialView(product, "back", mockupSettings));
  const [orderItems, setOrderItems] = useState<StructuredOrderItem[]>(() => [makeStructuredOrderItem(product, product.colors[0]?.name, "primary")]);
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [smsConsent, setSmsConsent] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [delivery, setDelivery] = useState("");
  const [shippingAddress, setShippingAddress] = useState<ShippingAddress>({ ...blankAddress, name: initialName });
  const [discountCode, setDiscountCode] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [reminder, setReminder] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [loadedExample, setLoadedExample] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const primaryItem = orderItems[0] ?? makeStructuredOrderItem(product, product.colors[0]?.name, "primary");
  const colorName = primaryItem.colorName;
  const selectedColor = product.colors.find((color) => color.name === colorName) ?? product.colors[0];
  const isCustomProduct = product.previewKind === "custom";
  const current = activeView === "front" ? front : back;
  const enabledViews = useMemo(() => activeViews(product, coverage), [product, coverage]);
  const currentPlacement = placementFor(product, activeView, current.placement);
  const totalQuantity = orderItemsQuantity(orderItems);

  function setPrimaryColor(nextColor: string) {
    setOrderItems((items) => items.map((item, index) => index === 0 ? { ...item, colorName: nextColor } : item));
  }

  function setView(view: ViewKey, updater: ViewState | ((value: ViewState) => ViewState)) {
    const apply = (currentValue: ViewState) => typeof updater === "function" ? updater(currentValue) : updater;
    if (view === "front") setFront(apply);
    else setBack(apply);
  }

  function selectCoverage(value: Coverage) {
    setCoverage(value);
    setLoadedExample(null);
    const views = activeViews(product, value);
    if (!views.includes(activeView)) setActiveView(views[0]);
  }

  function choosePlacement(view: ViewKey, value: string) {
    const placement = placementFor(product, view, value);
    setView(view, (state) => ({ ...state, placement: placement.value, x: placement.x, y: placement.y, width: placement.width, rotation: 0 }));
    setLoadedExample(null);
  }

  function chooseMode(view: ViewKey, mode: ArtworkMode) {
    setView(view, (state) => ({ ...state, mode }));
    setLoadedExample(null);
    setReminder("");
  }

  function chooseFile(view: ViewKey, file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(`${file.name} is larger than 20 MB.`);
      return;
    }
    setError("");
    setReminder("");
    setView(view, (state) => {
      if (state.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(state.previewUrl);
      const previewable = isPreviewableImage(file);
      return { ...state, mode: "upload", file, previewable, previewUrl: previewable ? URL.createObjectURL(file) : null };
    });
  }

  function removeFile(view: ViewKey) {
    setView(view, (state) => {
      if (state.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(state.previewUrl);
      return { ...state, file: null, previewUrl: null, previewable: false };
    });
  }

  function onArtworkPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!stageRef.current || current.mode === "example") return;
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    const move = (clientX: number, clientY: number) => {
      const rect = stage.getBoundingClientRect();
      const x = clamp(((clientX - rect.left) / rect.width) * 100, 4, 96);
      const y = clamp(((clientY - rect.top) / rect.height) * 100, 4, 96);
      setView(activeView, (state) => ({ ...state, x, y }));
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

  function onArtworkResizePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (!stageRef.current || current.mode === "example") return;
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    const startView = activeView;
    const startState = startView === "front" ? front : back;
    const rect = stage.getBoundingClientRect();
    const centerX = rect.left + (startState.x / 100) * rect.width;

    const resize = (clientX: number) => {
      const width = clamp((Math.abs(clientX - centerX) * 2 / rect.width) * 100, 8, 90);
      setView(startView, (state) => ({ ...state, width }));
    };

    const onMove = (pointerEvent: PointerEvent) => resize(pointerEvent.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function applyExample(index: number) {
    const example = product.examples[index];
    if (!example) return;
    const hasBack = product.supportsBack && Boolean(example.backPlacement);
    setCoverage(hasBack ? "front-back" : "front");
    if (example.frontPlacement) {
      const placement = placementFor(product, "front", example.frontPlacement);
      setFront((state) => ({ ...state, mode: "example", placement: placement.value, x: placement.x, y: placement.y, width: placement.width, rotation: 0 }));
      setActiveView("front");
    }
    if (hasBack && example.backPlacement) {
      const placement = placementFor(product, "back", example.backPlacement);
      setBack((state) => ({ ...state, mode: "example", placement: placement.value, x: placement.x, y: placement.y, width: placement.width, rotation: 0 }));
    }
    setLoadedExample(example.name);
  }

  function viewIsReady(view: ViewKey) {
    const state = view === "front" ? front : back;
    if (state.mode === "upload") return Boolean(state.file);
    if (state.mode === "idea") return Boolean(state.idea.trim());
    return false;
  }

  function validateDesign() {
    if (isCustomProduct && !customItemType.trim()) return "Tell us what kind of item you want to make.";
    for (const view of enabledViews) {
      const state = view === "front" ? front : back;
      const label = product.viewLabels[view];
      if (state.mode === "example") return `Finish the ${label.toLowerCase()} design by choosing Upload my artwork or I need this created.`;
      if (state.mode === "upload" && !state.file) return `Choose the artwork file for the ${label.toLowerCase()} design.`;
      if (state.mode === "idea" && !state.idea.trim()) return `Add a short description of what you want created for the ${label.toLowerCase()} design.`;
    }
    return "";
  }

  function validateQuantities() {
    if (totalQuantity < 1) return "Add at least one item to your request.";
    const empty = orderItems.find((item) => orderItemQuantity(item) < 1);
    if (empty) return `Add a quantity for ${empty.productName} (${empty.colorName}) or remove that item.`;
    return "";
  }

  function validateContact() {
    if (!name.trim()) return "Please enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Please enter a valid email address.";
    if (delivery === "Shipping") {
      if (!shippingAddress.line1.trim() || !shippingAddress.city.trim() || !shippingAddress.state.trim() || !shippingAddress.postalCode.trim() || !shippingAddress.country.trim()) {
        return "Please complete the shipping address so we can calculate shipping and sales tax accurately.";
      }
    }
    return "";
  }

  function goToStep(next: RequestStep) {
    let validation = "";
    if (next > 1) validation = validateDesign();
    if (validation) {
      const firstMissing = enabledViews.find((view) => !viewIsReady(view));
      if (firstMissing) setActiveView(firstMissing);
      setError("");
      setReminder(validation);
      return;
    }
    if (next > 2) validation = validateQuantities();
    if (!validation && next > 3) validation = validateContact();
    if (validation) {
      setReminder("");
      setError(validation);
      return;
    }
    setError("");
    setReminder("");
    setRequestStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function instructionFor(view: ViewKey, state: ViewState) {
    const placement = placementFor(product, view, state.placement);
    const label = product.viewLabels[view];
    const source = state.mode === "upload" ? `uploaded artwork (${state.file?.name || "file"})` : `design needed: ${state.idea.trim()}`;
    return `${label}: ${placement.label}; ${source}; preview position ${Math.round(state.x)}% across / ${Math.round(state.y)}% down; preview width ${Math.round(state.width)}%; rotation ${Math.round(state.rotation)}°.`;
  }

  async function submitCustomization() {
    const validationError = validateDesign() || validateQuantities() || validateContact();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError("");

    const views = enabledViews;
    const stateByView: Record<ViewKey, ViewState> = { front, back };
    const fileEntries = views
      .map((view) => ({ view, state: stateByView[view] }))
      .filter((entry) => entry.state.mode === "upload" && Boolean(entry.state.file))
      .map((entry) => ({ view: entry.view, file: entry.state.file! }));
    const fileIndexByView = new Map<ViewKey, number>();
    fileEntries.forEach((entry, index) => fileIndexByView.set(entry.view, index));

    try {
      const artworkInstructions = views.map((view) => instructionFor(view, stateByView[view])).join("\n");
      const normalizedItems = orderItems.map((item, index) => ({
        ...item,
        productName: index === 0 && isCustomProduct && customItemType.trim() ? `${product.name} — ${customItemType.trim()}` : item.productName,
        customItemType: index === 0 && isCustomProduct ? customItemType.trim() : item.customItemType,
        customColorNotes: index === 0 ? customColorNotes.trim() : item.customColorNotes,
        designRelationship: index === 0 ? "primary" as const : item.designRelationship || "same",
      }));
      const colorSummary = normalizedItems.map((item) => `${item.productName}: ${item.colorName}`).join(" · ");
      const sizeSummary = normalizedItems.map((item) => `${item.productName} ${item.colorName}: ${compactSizeSummary(item) || `${orderItemQuantity(item)} each`}`).join(" | ");
      const productSummary = normalizedItems.length === 1 ? normalizedItems[0].productName : `${normalizedItems[0].productName} + ${normalizedItems.length - 1} more item type${normalizedItems.length === 2 ? "" : "s"}`;

      const payload = {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        smsConsent: Boolean(phone.trim()) && smsConsent,
        product: productSummary,
        quantity: totalQuantity,
        orderItems: normalizedItems,
        itemType: isCustomProduct && customItemType.trim() ? customItemType.trim() : product.shortName,
        colors: colorSummary,
        sizes: sizeSummary,
        logoSize: views.map((view) => `${product.viewLabels[view]} ${Math.round(stateByView[view].width)}% preview width`).join(" · "),
        printSides: coverageLabel(product, coverage),
        placements: views.map((view) => stateByView[view].placement),
        artworkInstructions,
        deadline,
        delivery,
        shippingAddress: delivery === "Shipping" ? { ...shippingAddress, name: shippingAddress.name.trim() || name.trim() } : null,
        notes: notes.trim(),
        discountCode: discountCode.trim(),
        website: "",
        files: fileEntries.map(({ file }) => ({ name: file.name, size: file.size, type: file.type })),
      };

      const response = await fetch("/api/custom-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not submit your customization.");
      if (!result.requestId || !result.submissionToken) {
        throw new Error("Your request was received, but the customization could not be attached. Please contact Moore Made with your request details.");
      }

      const supabase = getSupabaseBrowser();
      const pathByIndex = new Map<number, string>();
      let uploadWarning = false;

      for (const target of Array.isArray(result.uploads) ? result.uploads : []) {
        const entry = fileEntries[target.index];
        if (!entry?.file) continue;
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .uploadToSignedUrl(target.path, target.token, entry.file, { contentType: entry.file.type || undefined });
        if (uploadError) {
          console.error("Shop artwork upload failed", uploadError);
          uploadWarning = true;
        } else {
          pathByIndex.set(target.index, target.path);
        }
      }
      if (pathByIndex.size !== fileEntries.length) uploadWarning = fileEntries.length > 0;

      const uploadedPaths = Array.from(pathByIndex.entries()).sort((a, b) => a[0] - b[0]).map(([, path]) => path);
      const mockupDocument = {
        version: 2,
        source: "customer",
        productSlug: product.slug,
        productName: product.name,
        orderItems: normalizedItems,
        customItemType: isCustomProduct ? customItemType.trim() : "",
        customColorNotes: customColorNotes.trim(),
        colorName,
        previewKind: product.previewKind,
        activeViewId: activeView,
        views: (["front", "back"] as ViewKey[]).map((view) => {
          const state = stateByView[view];
          const uploadIndex = fileIndexByView.get(view);
          const uploadedPath = uploadIndex === undefined ? null : pathByIndex.get(uploadIndex) || null;
          return {
            id: view,
            name: product.viewLabels[view],
            base: null,
            layers: uploadedPath ? [{
              id: `${view}-customer-artwork`,
              asset: { path: uploadedPath, originalName: state.file?.name || "Customer artwork", bucket: "custom-request-files" },
              x: state.x,
              y: state.y,
              width: state.width,
              rotation: state.rotation,
              opacity: 1,
              zIndex: 1,
            }] : [],
            customerIntent: {
              enabled: views.includes(view),
              source: state.mode,
              placement: state.placement,
              placementLabel: placementFor(product, view, state.placement).label,
              idea: state.mode === "idea" ? state.idea.trim() : "",
              artworkFileName: state.mode === "upload" ? state.file?.name || "" : "",
              x: state.x,
              y: state.y,
              width: state.width,
              rotation: state.rotation,
            },
            template: {
              productSlug: product.slug,
              productName: isCustomProduct && customItemType.trim() ? customItemType.trim() : product.name,
              previewKind: product.previewKind,
              colorName,
              colorValue: selectedColor?.value || "#e6e0d8",
              viewKey: view,
            },
          };
        }),
      };

      const filesResponse = await fetch(`/api/custom-requests/${result.requestId}/files`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionToken: result.submissionToken, paths: uploadedPaths, mockupDocument }),
      });
      const filesResult = await filesResponse.json().catch(() => ({}));
      if (!filesResponse.ok) uploadWarning = true;

      setSuccess({
        requestNumber: result.requestNumber,
        uploadWarning,
        mockupWarning: Boolean(filesResult.mockupWarning),
        emailWarning: Boolean(result.emailWarning),
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Could not submit your customization.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <section className="customerCustomizerSuccess card" role="status">
        <div className="successMark">✓</div>
        <div className="eyebrow">Customization received</div>
        <h2>Your idea is with Moore Made.</h2>
        <p>Your reference is <strong>{formatRequestNumber(success.requestNumber)}</strong>. We saved your products, sizes, colors, placement instructions, and artwork/idea details. We&apos;ll review everything and send the production-ready proof + personalized quote before anything is made.</p>
        {success.uploadWarning ? <p className="requestWarning">Your request was saved, but one or more artwork files may need to be sent again. We can still see the rest of your customization.</p> : null}
        {success.mockupWarning ? <p className="requestWarning">Your request and placement instructions are saved. The editable Mockup Studio copy needs the latest Supabase Mockup Studio migration before it can be opened in Admin.</p> : null}
        {success.emailWarning ? <p className="requestWarning">Your request is saved, but the confirmation email may not have sent.</p> : null}
        <div className="actions"><Link className="btn" href="/account">View my account</Link><Link className="btn secondary" href="/shop">Back to shop</Link></div>
      </section>
    );
  }

  const overlay = current.mode === "upload"
    ? current.previewUrl && current.previewable
      ? <img src={current.previewUrl} alt="Your uploaded artwork preview" draggable={false} />
      : <div className="customerArtworkFilePlaceholder"><strong>ARTWORK</strong><span>{displayFileName(current.file)}</span></div>
    : current.mode === "idea"
      ? <div className="customerIdeaPlaceholder"><strong>YOUR IDEA</strong><span>{current.idea.trim() || "Describe it in the controls"}</span></div>
      : <img src="/moore-made-logo.png" alt="Moore Made example artwork" draggable={false} />;

  return (
    <div className="customerCustomizer customerCustomizerWizard">
      <nav className="customerRequestStepper" aria-label="Custom request progress">
        {([1, 2, 3, 4] as RequestStep[]).map((step) => (
          <button key={step} type="button" className={requestStep === step ? "active" : requestStep > step ? "complete" : ""} onClick={() => { if (step <= requestStep) goToStep(step); }}>
            <span>{requestStep > step ? "✓" : step}</span><strong>{stepLabel(step)}</strong>
          </button>
        ))}
      </nav>

      {requestStep === 1 ? (
        <>
          <section className="customerCustomizerIntro">
            <div><div className="eyebrow">Step 1 · Product & design</div><h2>Show us what the main design should look like.</h2><p>Choose the side, placement, size, and artwork. Drag the preview wherever you want it. Additional colors/products come next.</p></div>
            <div className="customerPreviewOnly"><strong>Preview, not final proof</strong><span>We&apos;ll check sizing, printability, and production details before you pay.</span></div>
          </section>

          {product.examples.length && !isCustomProduct ? (
            <section className="customerExampleStrip">
              <div className="customerExampleStripHead"><strong>Need a starting point?</strong><span>Load an example layout, then replace the Moore Made logo with your artwork or idea.</span></div>
              <div className="customerExampleButtons">{product.examples.map((example, index) => <button type="button" key={example.name} className={loadedExample === example.name ? "active" : ""} onClick={() => applyExample(index)}><strong>{example.name}</strong><span>{example.description}</span></button>)}</div>
            </section>
          ) : null}

          <div className="customerCustomizerWorkspace">
            <div className="customerCustomizerPreviewColumn">
              <div className="customerPreviewToolbar">
                <div className="customerPreviewingLabel"><span>Previewing</span><strong>{product.viewLabels[activeView]}</strong></div>
                <span>{isCustomProduct ? (customItemType.trim() || "Custom item") : colorName} · {coverageLabel(product, coverage)}</span>
              </div>
              <div className="customerMockupStage">
                <ProductVisual rootRef={stageRef} kind={product.previewKind} color={selectedColor?.value || "#e6e0d8"} className="customerProductVisual" mockupSettings={mockupSettings}>
                  <div className={`customerArtworkLayer ${current.mode === "example" ? "isExample" : "isEditable"}`} style={{ left: `${current.x}%`, top: `${current.y}%`, width: `${current.width}%`, transform: `translate(-50%, -50%) rotate(${current.rotation}deg)` }} onPointerDown={onArtworkPointerDown}>
                    {overlay}
                    {current.mode !== "example" ? <>
                      <button className="customerArtworkResizeHandle handleNW" type="button" aria-label="Resize design" onPointerDown={onArtworkResizePointerDown} />
                      <button className="customerArtworkResizeHandle handleNE" type="button" aria-label="Resize design" onPointerDown={onArtworkResizePointerDown} />
                      <button className="customerArtworkResizeHandle handleSW" type="button" aria-label="Resize design" onPointerDown={onArtworkResizePointerDown} />
                      <button className="customerArtworkResizeHandle handleSE" type="button" aria-label="Resize design" onPointerDown={onArtworkResizePointerDown} />
                    </> : null}
                  </div>
                </ProductVisual>
              </div>
              <div className="customerPreviewHint">{current.mode === "example" ? <span>This Moore Made logo is only an example. Choose <strong>Upload my artwork</strong> or <strong>I need this created</strong> to make this side yours.</span> : <span><strong>Drag the design to move it.</strong> Drag any corner handle to resize, or use the controls for exact size and rotation.</span>}</div>
            </div>

            <aside className="customerCustomizerControls">
              <section className="customerControlSection">
                <div className="customerControlNumber">01</div>
                <div className="customerControlContent">
                  <div className="customerControlHeading"><div><h3>Product setup</h3><p>{isCustomProduct ? "Tell us what the item is, then choose the closest color and design areas." : "Choose the main item color and which sides you want decorated."}</p></div><span className="customerLiveBadge">Live preview</span></div>
                  {isCustomProduct ? <label className="field customerCustomItemField"><span>What are you making? *</span><input value={customItemType} onChange={(event) => setCustomItemType(event.target.value)} maxLength={180} placeholder="Example: apron, sign, pillow, gift box…" /></label> : null}
                  <div className="field"><span className="customerFieldLabel">{isCustomProduct ? "Preferred color" : "Product color"}</span><div className="customerColorSwatches">{product.colors.map((color) => <button key={color.name} type="button" className={`customerColorSwatch ${colorName === color.name ? "active" : ""}`} aria-pressed={colorName === color.name} onClick={() => setPrimaryColor(color.name)} title={color.name}><span className="customerColorDot" style={{ background: color.value }} /><span>{color.name}</span>{colorName === color.name ? <b aria-hidden="true">✓</b> : null}</button>)}</div></div>
                  {isCustomProduct ? <label className="field"><span>Color / material notes <small>Optional</small></span><input value={customColorNotes} onChange={(event) => setCustomColorNotes(event.target.value)} maxLength={240} placeholder="Example: sage green, stainless steel, natural wood…" /></label> : null}
                  {product.supportsBack ? <div className="field"><span className="customerFieldLabel">Design sides</span><div className="customerChoiceGrid three"><button type="button" aria-pressed={coverage === "front"} className={coverage === "front" ? "active" : ""} onClick={() => selectCoverage("front")}>{product.viewLabels.front} only</button><button type="button" aria-pressed={coverage === "back"} className={coverage === "back" ? "active" : ""} onClick={() => selectCoverage("back")}>{product.viewLabels.back} only</button><button type="button" aria-pressed={coverage === "front-back"} className={coverage === "front-back" ? "active" : ""} onClick={() => selectCoverage("front-back")}>Both</button></div>
                    <div className="customerSideSetup">
                      <div><strong>{coverage === "front-back" ? "Both sides selected" : `${coverageLabel(product, coverage)} selected`}</strong><span>{coverage === "front-back" ? "Set up the front and back below before moving to quantities." : "Use the design button below to switch the preview and finish this side."}</span></div>
                      <div className="customerSideSetupButtons">{enabledViews.map((view) => <button key={view} type="button" className={activeView === view ? "active" : ""} onClick={() => { setActiveView(view); setReminder(""); }}><span>{product.viewLabels[view]} design</span><small>{viewIsReady(view) ? "Ready ✓" : "Needs setup"}</small></button>)}</div>
                    </div>
                  </div> : null}
                </div>
              </section>

              <section className="customerControlSection">
                <div className="customerControlNumber">02</div>
                <div className="customerControlContent">
                  <div className="customerControlHeading"><div><h3>{product.viewLabels[activeView]} design</h3><p>Choose a placement, then add your artwork or describe what Moore Made should create.</p></div></div>
                  <label className="field"><span>Placement</span><select value={current.placement} onChange={(event) => choosePlacement(activeView, event.target.value)}>{product.placements[activeView].map((placement) => <option key={placement.value} value={placement.value}>{placement.label}</option>)}</select></label>
                  <div className="field"><span className="customerFieldLabel">What goes here?</span><div className="customerArtworkModes"><button type="button" aria-pressed={current.mode === "upload"} className={current.mode === "upload" ? "active" : ""} onClick={() => chooseMode(activeView, "upload")}><strong>Upload my artwork</strong><span>I already have a logo, photo, or design.</span></button><button type="button" aria-pressed={current.mode === "idea"} className={current.mode === "idea" ? "active" : ""} onClick={() => chooseMode(activeView, "idea")}><strong>I need this created</strong><span>I have the idea. Moore Made can design it.</span></button></div></div>
                  {current.mode === "upload" ? <div className="customerModePanel"><label className="btn secondary customerUploadButton">{current.file ? "Replace artwork" : "Choose artwork"}<input type="file" hidden accept="image/*,.pdf,.svg" onChange={(event) => { chooseFile(activeView, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>{current.file ? <div className="customerSelectedFile"><span>{displayFileName(current.file)}</span><button type="button" onClick={() => removeFile(activeView)}>Remove</button></div> : <small>Images and SVGs preview directly. PDFs are still accepted and will show as a placement placeholder.</small>}</div> : null}
                  {current.mode === "idea" ? <div className="customerModePanel"><label className="field"><span>What should we create here?</span><textarea value={current.idea} onChange={(event) => setView(activeView, (state) => ({ ...state, idea: event.target.value }))} maxLength={3000} placeholder={`Example: ${activeView === "front" ? "Small circular business logo with our company name and a simple tree." : "Large back design with the business name, phone number, and a landscaping theme."}`} /></label><small>You can still use the preview box to show roughly where the finished design should sit and how large it should feel.</small></div> : null}
                  {current.mode !== "example" ? <div className="customerPlacementControls"><label><span>Size <b>{Math.round(current.width)}%</b></span><input type="range" min="8" max="80" step="1" value={current.width} onChange={(event) => setView(activeView, (state) => ({ ...state, width: Number(event.target.value) }))} /></label><label><span>Rotation <b>{Math.round(current.rotation)}°</b></span><input type="range" min="-180" max="180" step="1" value={current.rotation} onChange={(event) => setView(activeView, (state) => ({ ...state, rotation: Number(event.target.value) }))} /></label><button type="button" className="customerResetPlacement" onClick={() => choosePlacement(activeView, current.placement)}>Reset to {currentPlacement.label}</button></div> : null}
                  {enabledViews.length > 1 ? <div className="customerNextSideRow">{activeView === "front" ? <button type="button" onClick={() => setActiveView("back")}>Next: customize {product.viewLabels.back.toLowerCase()} →</button> : <button type="button" onClick={() => setActiveView("front")}>← Back to {product.viewLabels.front.toLowerCase()}</button>}</div> : null}
                </div>
              </section>
            </aside>
          </div>
          {reminder ? <div className="customerDesignReminder" role="status"><span className="customerReminderIcon">i</span><div><strong>Quick design reminder</strong><p>{reminder}</p></div></div> : null}
          {error ? <div className="formError" role="alert">{error}</div> : null}
          <div className="customerWizardNav"><span>No prices are shown here. Moore Made will send a personalized quote after review.</span><button className="btn" type="button" onClick={() => goToStep(2)}>Continue to quantities →</button></div>
        </>
      ) : null}

      {requestStep === 2 ? (
        <section className="customerWizardPanel card">
          <OrderItemsBuilder items={orderItems} onChange={setOrderItems} primaryProduct={product} />
          {error ? <div className="formError" role="alert">{error}</div> : null}
          <div className="customerWizardNav"><button className="btn secondary" type="button" onClick={() => goToStep(1)}>← Back to design</button><button className="btn" type="button" onClick={() => goToStep(3)}>Continue to contact & delivery →</button></div>
        </section>
      ) : null}

      {requestStep === 3 ? (
        <section className="customerWizardPanel card">
          <div className="customerOrderDetailsHead"><div><div className="eyebrow">Step 3 · Contact & delivery</div><h2>Where should we send your proof and quote?</h2></div><span>No payment is taken yet.</span></div>
          <div className="customerOrderGrid">
            <label className="field"><span>Name *</span><input value={name} onChange={(event) => { setName(event.target.value); if (!shippingAddress.name) setShippingAddress((address) => ({ ...address, name: event.target.value })); }} maxLength={160} autoComplete="name" /></label>
            <label className="field"><span>Email *</span><input value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} type="email" autoComplete="email" /></label>
            <label className="field"><span>Phone <small>Optional</small></span><input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={80} type="tel" autoComplete="tel" /></label>
            <label className={`customerSmsConsent ${phone.trim() ? "" : "isDisabled"}`}><input type="checkbox" checked={smsConsent} onChange={(event) => setSmsConsent(event.target.checked)} disabled={!phone.trim()} /><span><strong>Text updates</strong><small>{phone.trim() ? "Yes, Moore Made may text me about this order." : "Add a phone number above to enable order text updates."}</small></span></label>
            <label className="field"><span>Needed by <small>Optional</small></span><input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
            <label className="field"><span>Pickup or shipping?</span><select value={delivery} onChange={(event) => setDelivery(event.target.value)}><option value="">Not sure yet</option><option>Local pickup</option><option>Shipping</option></select></label>
          </div>

          {delivery === "Shipping" ? (
            <div className="shippingAddressPanel">
              <div><strong>Shipping address</strong><span>We&apos;ll use this for shipping and the automatic sales-tax calculation when your quote is prepared.</span></div>
              <div className="customerOrderGrid">
                <label className="field"><span>Recipient</span><input value={shippingAddress.name} onChange={(event) => setShippingAddress((address) => ({ ...address, name: event.target.value }))} autoComplete="shipping name" /></label>
                <label className="field"><span>Street address *</span><input value={shippingAddress.line1} onChange={(event) => setShippingAddress((address) => ({ ...address, line1: event.target.value }))} autoComplete="shipping address-line1" /></label>
                <label className="field"><span>Apt / suite <small>Optional</small></span><input value={shippingAddress.line2} onChange={(event) => setShippingAddress((address) => ({ ...address, line2: event.target.value }))} autoComplete="shipping address-line2" /></label>
                <label className="field"><span>City *</span><input value={shippingAddress.city} onChange={(event) => setShippingAddress((address) => ({ ...address, city: event.target.value }))} autoComplete="shipping address-level2" /></label>
                <label className="field"><span>State *</span><input value={shippingAddress.state} onChange={(event) => setShippingAddress((address) => ({ ...address, state: event.target.value.toUpperCase().slice(0, 2) }))} maxLength={2} autoComplete="shipping address-level1" placeholder="OH" /></label>
                <label className="field"><span>ZIP *</span><input value={shippingAddress.postalCode} onChange={(event) => setShippingAddress((address) => ({ ...address, postalCode: event.target.value }))} autoComplete="shipping postal-code" /></label>
                <label className="field"><span>Country *</span><select value={shippingAddress.country} onChange={(event) => setShippingAddress((address) => ({ ...address, country: event.target.value }))}><option value="US">United States</option></select></label>
              </div>
            </div>
          ) : null}

          <div className="customerOrderGrid requestFinalDetails">
            <label className="field"><span>Discount code <small>Optional</small></span><input value={discountCode} onChange={(event) => setDiscountCode(event.target.value.toUpperCase())} maxLength={80} placeholder="Example: FAMILY10" /><small>We&apos;ll verify it when preparing your quote.</small></label>
            <label className="field"><span>Anything else? <small>Optional</small></span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} placeholder="Budget, event details, special requests, inspiration, or anything else we should know." /></label>
          </div>
          {error ? <div className="formError" role="alert">{error}</div> : null}
          <div className="customerWizardNav"><button className="btn secondary" type="button" onClick={() => goToStep(2)}>← Back to quantities</button><button className="btn" type="button" onClick={() => goToStep(4)}>Review request →</button></div>
        </section>
      ) : null}

      {requestStep === 4 ? (
        <section className="customerWizardPanel card customerReviewPanel">
          <div className="customerOrderDetailsHead"><div><div className="eyebrow">Step 4 · Review</div><h2>One request, everything organized.</h2></div><span>{totalQuantity} total piece{totalQuantity === 1 ? "" : "s"}</span></div>
          <div className="customerReviewItems">
            {orderItems.map((item, index) => <div className="customerReviewItem" key={item.id}><div><strong>{item.productName}</strong><span>{item.colorName}{index === 0 ? " · primary customized item" : item.designRelationship === "separate" ? " · separate design requested" : " · same design direction"}</span></div><div><strong>{orderItemQuantity(item)} pcs</strong><span>{compactSizeSummary(item)}</span></div></div>)}
          </div>
          <div className="customerReviewFacts">
            <div><span>Design</span><strong>{coverageLabel(product, coverage)}</strong></div>
            <div><span>Contact</span><strong>{name} · {email}</strong></div>
            <div><span>Fulfillment</span><strong>{delivery || "Not sure yet"}</strong></div>
            <div><span>Pricing</span><strong>Personalized quote after review</strong></div>
          </div>
          {delivery === "Shipping" ? <div className="customerReviewAddress"><span>Ship to</span><strong>{shippingAddress.line1}{shippingAddress.line2 ? `, ${shippingAddress.line2}` : ""}, {shippingAddress.city}, {shippingAddress.state} {shippingAddress.postalCode}</strong></div> : null}
          <div className="customerReviewNotice"><strong>No payment is due now.</strong><span>Moore Made will review your product mix, artwork, supplies, labor, shipping, discount, and applicable tax. You&apos;ll receive a final proof + quote to approve before payment.</span></div>
          {error ? <div className="formError" role="alert">{error}</div> : null}
          <div className="customerWizardNav"><button className="btn secondary" type="button" onClick={() => goToStep(3)}>← Edit contact / delivery</button><button className="btn" type="button" disabled={submitting} onClick={submitCustomization}>{submitting ? "Sending your request…" : "Send request to Moore Made"}</button></div>
        </section>
      ) : null}
    </div>
  );
}
