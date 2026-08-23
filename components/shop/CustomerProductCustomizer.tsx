"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { findProductColor, isOtherProductColor, OTHER_PRODUCT_COLOR, otherProductColorPreference, type Product, type PlacementOption } from "@/lib/catalog";
import type { CatalogMockupSettings } from "@/lib/mockup-template-types";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { compactSizeSummary, orderItemQuantity, orderItemsQuantity, type ShippingAddress, type StructuredOrderItem } from "@/lib/order-types";
import { ProductVisual } from "@/components/shop/ProductVisual";
import { makeStructuredOrderItem, OrderItemsBuilder } from "@/components/shop/OrderItemsBuilder";
import { ARTWORK_RIGHTS_POLICY_VERSION, ARTWORK_RIGHTS_UPLOAD_LABEL } from "@/lib/artwork-rights";
import { CUSTOMER_PRODUCTION_NOTICE } from "@/lib/customer-production-notice";
import { addCustomRequestCartItem } from "@/lib/custom-request-cart";

const BUCKET = "custom-request-files";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

type ViewKey = "front" | "back";
type ArtworkMode = "upload" | "idea";
type InteractionMode = "move" | "resize" | "rotate";
type Coverage = "front" | "back" | "front-back";
type RequestStep = 1 | 2 | 3 | 4;

type ViewState = {
  mode: ArtworkMode;
  placement: string;
  idea: string;
  details: string;
  backgroundRemovalRequested: boolean;
  file: File | null;
  previewUrl: string | null;
  previewable: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
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

function normalizeRotation(value: number) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function isPreviewableImage(file: File) {
  return file.type.startsWith("image/") || /\.svg$/i.test(file.name);
}

function artworkSizeBounds(product: Product) {
  if (product.previewKind === "tee" || product.previewKind === "polo" || product.previewKind === "hoodie") return { min: 10, start: 28, max: 55 };
  if (product.previewKind === "mug") return { min: 10, start: 25, max: 46 };
  if (product.previewKind === "tote") return { min: 10, start: 30, max: 52 };
  if (product.previewKind === "coaster" || product.previewKind === "sticker") return { min: 10, start: 28, max: 48 };
  if (product.previewKind === "card" || product.previewKind === "bookmark") return { min: 10, start: 36, max: 68 };
  return { min: 10, start: 30, max: 56 };
}

function artworkHeightBounds(product: Product) {
  if (product.previewKind === "card" || product.previewKind === "bookmark") return { min: 6, start: 22, max: 70 };
  return { min: 6, start: 14, max: 62 };
}

type PrintArea = { left: number; right: number; top: number; bottom: number };

function artworkPrintArea(product: Product): PrintArea {
  if (product.previewKind === "tee" || product.previewKind === "polo") return { left: 30, right: 70, top: 20, bottom: 82 };
  if (product.previewKind === "hoodie") return { left: 29, right: 71, top: 23, bottom: 81 };
  if (product.previewKind === "mug") return { left: 26, right: 74, top: 25, bottom: 75 };
  if (product.previewKind === "tote") return { left: 21, right: 79, top: 24, bottom: 82 };
  if (product.previewKind === "card") return { left: 9, right: 91, top: 22, bottom: 78 };
  if (product.previewKind === "bookmark") return { left: 8, right: 92, top: 32, bottom: 68 };
  if (product.previewKind === "coaster" || product.previewKind === "sticker") return { left: 25, right: 75, top: 18, bottom: 82 };
  return { left: 20, right: 80, top: 16, bottom: 84 };
}

function placementFor(product: Product, view: ViewKey, value?: string): PlacementOption {
  const options = product.placements[view];
  return options.find((item) => item.value === value) ?? options[0] ?? { value: "custom", label: "Custom placement", x: 50, y: 50, width: 35 };
}

function initialView(product: Product, view: ViewKey): ViewState {
  const placement = product.placements[view].find((option) => option.value.includes("custom")) ?? placementFor(product, view);
  const size = artworkSizeBounds(product);
  const height = artworkHeightBounds(product);
  return {
    mode: "upload",
    placement: placement.value,
    idea: "",
    details: "",
    backgroundRemovalRequested: false,
    file: null,
    previewUrl: null,
    previewable: false,
    x: 50,
    y: 50,
    width: size.start,
    height: height.start,
    rotation: 0,
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
  savedBusinessLogos = [],
}: {
  product: Product;
  initialName?: string;
  initialEmail?: string;
  initialPhone?: string;
  mockupSettings?: CatalogMockupSettings;
  savedBusinessLogos?: Array<{ id: string; label: string; name: string; url: string }>;
}) {
  const [requestStep, setRequestStep] = useState<RequestStep>(1);
  const [addingToCart, setAddingToCart] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);
  const [coverage, setCoverage] = useState<Coverage>("front");
  const [activeView, setActiveView] = useState<ViewKey>("front");
  const [reviewView, setReviewView] = useState<ViewKey>("front");
  const [reviewColorName, setReviewColorName] = useState(product.colors[0]?.name || "Default");
  const [customItemType, setCustomItemType] = useState("");
  const [customColorNotes, setCustomColorNotes] = useState("");
  const [front, setFront] = useState<ViewState>(() => initialView(product, "front"));
  const [back, setBack] = useState<ViewState>(() => initialView(product, "back"));
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
  const [artworkRightsAccepted, setArtworkRightsAccepted] = useState(false);
  const [error, setError] = useState("");
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("move");
  const [loadingSavedLogoId, setLoadingSavedLogoId] = useState<string | null>(null);
  const [reminder, setReminder] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const ideaPromptRef = useRef<HTMLTextAreaElement | null>(null);

  const primaryItem = orderItems[0] ?? makeStructuredOrderItem(product, product.colors[0]?.name, "primary");
  const colorName = primaryItem.colorName;
  const selectedColor = findProductColor(product, colorName);
  const isCustomProduct = product.previewKind === "custom";
  const current = activeView === "front" ? front : back;
  const printArea = artworkPrintArea(product);

  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".productCustomizePage");
    if (!page) return;
    page.dataset.customizerStep = String(requestStep);
    return () => { delete page.dataset.customizerStep; };
  }, [requestStep]);
  const enabledViews = useMemo(() => activeViews(product, coverage), [product, coverage]);
  const totalQuantity = orderItemsQuantity(orderItems);
  const hasCustomerArtwork = enabledViews.some((view) => {
    const state = view === "front" ? front : back;
    return state.mode === "upload" && Boolean(state.file);
  });

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
    const views = activeViews(product, value);
    if (!views.includes(activeView)) setActiveView(views[0]);
  }

  function chooseMode(view: ViewKey, mode: ArtworkMode) {
    setView(view, (state) => ({ ...state, mode }));
    setInteractionMode("move");
    setReminder("");
  }

  function openIdeaPrompt(view: ViewKey) {
    chooseMode(view, "idea");
    window.setTimeout(() => {
      ideaPromptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      ideaPromptRef.current?.focus({ preventScroll: true });
    }, 40);
  }

  function chooseFile(view: ViewKey, file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(`${file.name} is larger than 20 MB.`);
      return;
    }
    setError("");
    setReminder("");
    setInteractionMode("move");
    const previewable = isPreviewableImage(file);
    const previewUrl = previewable ? URL.createObjectURL(file) : null;
    setView(view, (state) => {
      if (state.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(state.previewUrl);
      return { ...state, mode: "upload", file, previewable, previewUrl, backgroundRemovalRequested: false };
    });
    if (previewUrl) {
      const image = new window.Image();
      image.onload = () => {
        const heightBounds = artworkHeightBounds(product);
        const area = artworkPrintArea(product);
        setView(view, (state) => state.previewUrl === previewUrl ? { ...state, height: clamp(state.width * (image.naturalHeight / Math.max(1, image.naturalWidth)) * (4 / 3), heightBounds.min, Math.min(heightBounds.max, area.bottom - area.top)) } : state);
      };
      image.src = previewUrl;
    }
  }

  async function useSavedBusinessLogo(view: ViewKey, logo: { id: string; label: string; name: string; url: string }) {
    setLoadingSavedLogoId(logo.id); setError("");
    try {
      const response = await fetch(logo.url);
      if (!response.ok) throw new Error("This saved logo could not be opened. Refresh the page and try again.");
      const blob = await response.blob();
      chooseFile(view, new File([blob], logo.name || `${logo.label}.png`, { type: blob.type }));
    } catch (logoError) {
      setError(logoError instanceof Error ? logoError.message : "This saved logo could not be opened.");
    } finally {
      setLoadingSavedLogoId(null);
    }
  }

  function removeFile(view: ViewKey) {
    setView(view, (state) => {
      if (state.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(state.previewUrl);
      return { ...state, file: null, previewUrl: null, previewable: false, backgroundRemovalRequested: false };
    });
  }

  function onArtworkPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (!stageRef.current || interactionMode !== "move") return;
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    const move = (clientX: number, clientY: number) => {
      const rect = stage.getBoundingClientRect();
      const halfWidth = current.width / 2;
      const halfHeight = current.height / 2;
      const x = clamp(((clientX - rect.left) / rect.width) * 100, printArea.left + halfWidth, printArea.right - halfWidth);
      const y = clamp(((clientY - rect.top) / rect.height) * 100, printArea.top + halfHeight, printArea.bottom - halfHeight);
      setView(activeView, (state) => ({ ...state, x, y }));
    };
    move(event.clientX, event.clientY);
    const onMove = (pointerEvent: PointerEvent) => move(pointerEvent.clientX, pointerEvent.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
  }

  function onArtworkResizePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (!stageRef.current || interactionMode !== "resize") return;
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    const startView = activeView;
    const startState = startView === "front" ? front : back;
    const rect = stage.getBoundingClientRect();
    const centerX = rect.left + (startState.x / 100) * rect.width;
    const centerY = rect.top + (startState.y / 100) * rect.height;

    const size = artworkSizeBounds(product);
    const heightSize = artworkHeightBounds(product);
    const resize = (clientX: number, clientY: number) => {
      const maxWidthAtPosition = Math.max(size.min, Math.min(size.max, (startState.x - printArea.left) * 2, (printArea.right - startState.x) * 2));
      const maxHeightAtPosition = Math.max(heightSize.min, Math.min(heightSize.max, (startState.y - printArea.top) * 2, (printArea.bottom - startState.y) * 2));
      const width = clamp((Math.abs(clientX - centerX) * 2 / rect.width) * 100, size.min, maxWidthAtPosition);
      const height = clamp((Math.abs(clientY - centerY) * 2 / rect.height) * 100, heightSize.min, maxHeightAtPosition);
      setView(startView, (state) => ({ ...state, width, height }));
    };

    const onMove = (pointerEvent: PointerEvent) => resize(pointerEvent.clientX, pointerEvent.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
  }

  function onArtworkRotatePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (!stageRef.current || interactionMode !== "rotate") return;
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    const startView = activeView;
    const startState = startView === "front" ? front : back;
    const rect = stage.getBoundingClientRect();
    const centerX = rect.left + (startState.x / 100) * rect.width;
    const centerY = rect.top + (startState.y / 100) * rect.height;
    const startPointerAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * (180 / Math.PI);

    const rotate = (clientX: number, clientY: number) => {
      const pointerAngle = Math.atan2(clientY - centerY, clientX - centerX) * (180 / Math.PI);
      const rawRotation = startState.rotation + pointerAngle - startPointerAngle;
      const rotation = normalizeRotation(rawRotation);
      setView(startView, (state) => ({ ...state, rotation }));
    };

    const onMove = (pointerEvent: PointerEvent) => rotate(pointerEvent.clientX, pointerEvent.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
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
      if (state.mode === "upload" && !state.file) return `Choose the artwork file for the ${label.toLowerCase()} design.`;
      if (state.mode === "idea" && !state.idea.trim()) return `Add a short description of what you want created for the ${label.toLowerCase()} design.`;
    }
    return "";
  }

  function validateQuantities() {
    if (totalQuantity < 1) return "Add at least one item to your request.";
    const missingOtherColor = orderItems.find((item) => isOtherProductColor(item.colorName) && !otherProductColorPreference(item.colorName).trim());
    if (missingOtherColor) return `Enter the preferred color for ${missingOtherColor.productName}, or choose a listed color.`;
    const empty = orderItems.find((item) => orderItemQuantity(item) < 1);
    if (empty) return `Add a quantity for ${empty.productName} (${empty.colorName}) or remove that item.`;
    return "";
  }

  async function addCurrentDesignToCart() {
    const validation = validateDesign() || validateQuantities();
    if (validation) {
      setError(validation);
      return;
    }

    setAddingToCart(true);
    setError("");
    try {
      const normalizedItems = orderItems.map((item, index) => ({
        ...item,
        productName: index === 0 && isCustomProduct && customItemType.trim() ? `${product.name} — ${customItemType.trim()}` : item.productName,
        customItemType: index === 0 && isCustomProduct ? customItemType.trim() : item.customItemType,
        customColorNotes: index === 0 ? customColorNotes.trim() : item.customColorNotes,
        designRelationship: index === 0 ? "primary" as const : item.designRelationship || "same",
      }));
      const stateByView: Record<ViewKey, ViewState> = { front, back };
      await addCustomRequestCartItem({
        productSlug: product.slug,
        productName: isCustomProduct && customItemType.trim() ? `${product.name} — ${customItemType.trim()}` : product.name,
        previewKind: product.previewKind,
        viewLabels: product.viewLabels,
        coverageLabel: coverageLabel(product, coverage),
        colorName,
        customItemType: isCustomProduct ? customItemType.trim() : "",
        customColorNotes: customColorNotes.trim(),
        mockupSettings,
        orderItems: normalizedItems,
        views: (["front", "back"] as ViewKey[]).map((view) => {
          const state = stateByView[view];
          return {
            view,
            enabled: enabledViews.includes(view),
            mode: state.mode,
            placement: state.placement,
            placementLabel: placementFor(product, view, state.placement).label,
            idea: state.mode === "idea" ? state.idea.trim() : "",
            details: state.details.trim(),
            backgroundRemovalRequested: state.mode === "upload" ? state.backgroundRemovalRequested : false,
            file: state.mode === "upload" ? state.file : null,
            x: state.x,
            y: state.y,
            width: state.width,
            height: state.height,
            rotation: state.rotation,
          };
        }),
      });
      setAddedToCart(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cartError) {
      setError(cartError instanceof Error ? cartError.message : "Could not add this design to your request cart.");
    } finally {
      setAddingToCart(false);
    }
  }

  function validateContact() {
    if (!name.trim()) return "Please enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Please enter a valid email address.";
    if (delivery === "Shipping" || delivery === "Local delivery") {
      if (!shippingAddress.line1.trim() || !shippingAddress.city.trim() || !shippingAddress.state.trim() || !shippingAddress.postalCode.trim() || !shippingAddress.country.trim()) {
        return delivery === "Local delivery"
          ? "Please complete the delivery address so we can plan local delivery and calculate sales tax accurately."
          : "Please complete the shipping address so we can calculate shipping and sales tax accurately.";
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
    const label = product.viewLabels[view];
    const source = state.mode === "upload" ? `uploaded artwork (${state.file?.name || "file"})` : `design needed: ${state.idea.trim()}`;
    return `${label}: ${source}; placement: ${placementFor(product, view, state.placement).label}.${state.mode === "upload" && state.backgroundRemovalRequested ? " BACKGROUND REMOVAL REQUESTED — make the uploaded artwork background transparent; use vector redraw/vectorization instead of unsafe automatic enhancement when needed; include the artwork-preparation cost in the quote and send the finished proof for approval." : ""}${state.details.trim() ? ` Optional details: ${state.details.trim()}` : ""}`;
  }

  async function submitCustomization() {
    const validationError = validateDesign() || validateQuantities() || validateContact();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (hasCustomerArtwork && !artworkRightsAccepted) {
      setError("Please confirm that you own the artwork you uploaded or have permission to use it for this order.");
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
        shippingAddress: delivery === "Shipping" || delivery === "Local delivery" ? { ...shippingAddress, name: shippingAddress.name.trim() || name.trim() } : null,
        notes: notes.trim(),
        discountCode: discountCode.trim(),
        artworkRightsAccepted: hasCustomerArtwork ? artworkRightsAccepted : false,
        artworkRightsPolicyVersion: hasCustomerArtwork ? ARTWORK_RIGHTS_POLICY_VERSION : null,
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

      if (uploadWarning) {
        throw new Error("We could not finish uploading every artwork file. The request was not finalized as artwork-ready, so please retry the upload before leaving this page.");
      }

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
              height: state.height,
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
              details: state.details.trim(),
              artworkFileName: state.mode === "upload" ? state.file?.name || "" : "",
              backgroundRemovalRequested: state.mode === "upload" ? state.backgroundRemovalRequested : false,
              x: state.x,
              y: state.y,
              width: state.width,
              height: state.height,
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
        body: JSON.stringify({ submissionToken: result.submissionToken, paths: uploadedPaths, expectedUploadCount: fileEntries.length, mockupDocument }),
      });
      const filesResult = await filesResponse.json().catch(() => ({}));
      if (!filesResponse.ok) throw new Error(filesResult.error || "The artwork file could not be confirmed. Please retry the upload before leaving this page.");

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

  if (addedToCart) {
    return (
      <section className="customerCustomizerSuccess customerCartAdded card" role="status">
        <div className="successMark">✓</div>
        <div className="eyebrow">Added to request cart</div>
        <h2>Your {product.shortName.toLowerCase()} design is saved.</h2>
        <p>You can keep shopping and create another mockup, or open your cart to review every product, color, size, front, and back before sending one combined request to Moore Made.</p>
        <div className="actions"><Link className="btn secondary" href="/shop">Keep shopping</Link><Link className="btn" href="/cart">Review request cart →</Link></div>
      </section>
    );
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

  function artworkPreview(state: ViewState, alt: string) {
    return state.mode === "upload"
      ? !state.file
      ? null
      : state.previewUrl && state.previewable
      ? <img className="customerArtworkImage" src={state.previewUrl} alt={alt} draggable={false} style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, maxWidth: "none", maxHeight: "none", objectFit: "fill", objectPosition: "center" }} />
      : <div className="customerArtworkFilePlaceholder"><strong>ARTWORK</strong><span>{displayFileName(state.file)}</span></div>
    : state.mode === "idea"
      ? <div className="customerIdeaPlaceholder" aria-label="Placement area for the design Moore Made will create">{state.width >= 22 && state.height >= 12 ? <strong>DESIGN AREA</strong> : null}</div>
      : null;
  }

  const overlay = artworkPreview(current, "Your uploaded artwork preview");
  const reviewViews = enabledViews;
  const displayedReviewView: ViewKey = reviewViews.includes(reviewView) ? reviewView : reviewViews[0] || "front";
  const displayedReviewState = displayedReviewView === "front" ? front : back;
  const displayedReviewOverlay = artworkPreview(displayedReviewState, `Your ${product.viewLabels[displayedReviewView].toLowerCase()} artwork preview`);
  const reviewColorNames = Array.from(new Set(orderItems.filter((item) => item.productSlug === product.slug).map((item) => item.colorName)));
  const displayedReviewColorName = reviewColorNames.includes(reviewColorName) ? reviewColorName : reviewColorNames[0] || colorName;
  const displayedReviewColor = findProductColor(product, displayedReviewColorName) ?? selectedColor;

  function moveReviewView(direction: -1 | 1) {
    if (reviewViews.length < 2) return;
    const currentIndex = Math.max(0, reviewViews.indexOf(displayedReviewView));
    setReviewView(reviewViews[(currentIndex + direction + reviewViews.length) % reviewViews.length]);
  }

  function mockupReview(title: string, description: string) {
    return (
      <section className="customerMockupReview" aria-label={title}>
        <div className="customerMockupReviewHead">
          <div><div className="eyebrow">Design preview</div><h2>{title}</h2><p>{description}</p></div>
          {reviewColorNames.length > 1 ? <div className="customerMockupColorPicker" aria-label="Preview a selected color">{reviewColorNames.map((name) => {
            const color = findProductColor(product, name);
            return <button key={name} type="button" className={displayedReviewColorName === name ? "active" : ""} aria-pressed={displayedReviewColorName === name} onClick={() => setReviewColorName(name)}><span style={{ background: color?.value || "#e6e0d8" }} />{name}</button>;
          })}</div> : <span className="customerMockupSingleColor"><i style={{ background: displayedReviewColor?.value || "#e6e0d8" }} />{displayedReviewColorName}</span>}
        </div>
        <div className="customerMockupReviewStage">
          {reviewViews.length > 1 ? <button type="button" className="customerMockupArrow previous" onClick={() => moveReviewView(-1)} aria-label="Show previous side">←</button> : null}
          <ProductVisual kind={product.previewKind} view={displayedReviewView} label={displayedReviewView === "front" ? "FRONT" : "BACK"} color={displayedReviewColor?.value || "#e6e0d8"} className="customerMockupReviewVisual" mockupSettings={mockupSettings}>
            {displayedReviewOverlay ? <div className="customerArtworkLayer customerReviewArtworkLayer" style={{ left: `${displayedReviewState.x}%`, top: `${displayedReviewState.y}%`, width: `${displayedReviewState.width}%`, height: `${displayedReviewState.height}%`, transform: `translate(-50%, -50%) rotate(${displayedReviewState.rotation}deg)` }}>{displayedReviewOverlay}</div> : null}
          </ProductVisual>
          <span className="customerMockupStageViewLabel" aria-hidden="true">{displayedReviewView === "front" ? "FRONT" : "BACK"}</span>
          {reviewViews.length > 1 ? <button type="button" className="customerMockupArrow next" onClick={() => moveReviewView(1)} aria-label="Show next side">→</button> : null}
        </div>
        <div className="customerMockupViewTabs" aria-label="Choose a design side">{reviewViews.map((view) => <button key={view} type="button" className={displayedReviewView === view ? "active" : ""} aria-pressed={displayedReviewView === view} onClick={() => setReviewView(view)}>{product.viewLabels[view]}</button>)}</div>
        {displayedReviewState.mode === "idea" && displayedReviewState.idea.trim() ? <div className="customerIdeaSummary"><strong>Design idea</strong><p>{displayedReviewState.idea}</p></div> : null}
        {displayedReviewState.mode === "upload" && displayedReviewState.backgroundRemovalRequested ? <div className="customerBackgroundRemovalSummary"><strong>Transparent background requested</strong><span>Moore Made will include any artwork-preparation cost in the quote for approval.</span></div> : null}
        <div className="customerProductionNotice"><strong>Mockup & handmade production note</strong><span>{CUSTOMER_PRODUCTION_NOTICE}</span></div>
        <div className="customerTimingSummary" aria-label="Expected reply and production timing"><span><strong>Reply</strong>1–2 business days</span><span><strong>Production</strong>Usually 1+ week after proof approval and payment</span></div>
      </section>
    );
  }

  return (
    <div className="customerCustomizer customerCustomizerWizard">
      <nav className="customerRequestStepper" aria-label="Custom request progress">
        {([1, 2] as RequestStep[]).map((step) => (
          <button key={step} type="button" className={requestStep === step ? "active" : requestStep > step ? "complete" : ""} onClick={() => { if (step <= requestStep) goToStep(step); }}>
            <span>{requestStep > step ? "✓" : step}</span><strong>{stepLabel(step)}</strong>
          </button>
        ))}
      </nav>

      {requestStep === 1 ? (
        <>
          <section className="customerCustomizerIntro">
            <div><div className="eyebrow">Step 1 · Product & design</div><h2>Put your design where you want it.</h2><p>Upload artwork or describe your idea, then drag it and resize it freely on the product. Moore Made will refine the final proof before anything is made.</p></div>
          </section>

          <section className="customerArtworkStart">
            <div className="customerArtworkStartCopy"><strong>Add the {product.viewLabels[activeView].toLowerCase()} design</strong><span>Upload what you have, or tell Moore Made what to create.</span></div>
            <div className="customerArtworkStartActions"><label className="btn customerPrimaryUploadButton">{current.file ? "Replace photo or artwork" : "Upload photo or artwork"}<input type="file" hidden accept="image/*,.pdf,.svg" onChange={(event) => { chooseFile(activeView, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button type="button" className="btn secondary" onClick={() => openIdeaPrompt(activeView)}>Describe my idea</button></div>
            <p className="customerArtworkQualityNote"><strong>Send the best original file you have.</strong> Low-resolution artwork cannot always be safely enhanced. Logos may require professional vector redraw/vectorization. Detailed artwork may require a recreated proof and your approval because automated cleanup can subtly change lettering, shapes, faces, or colors. Any artwork-preparation cost will be included in your quote before production.</p>
            {savedBusinessLogos.length ? <div className="customerSavedLogoPicker"><div><strong>Use a saved business logo</strong><span>Choose one from your Business Profile, then position it on the product.</span></div><div>{savedBusinessLogos.map((logo) => <button type="button" key={logo.id} disabled={Boolean(loadingSavedLogoId)} onClick={() => void useSavedBusinessLogo(activeView, logo)}><img src={logo.url} alt="" /><span>{loadingSavedLogoId === logo.id ? "Opening…" : logo.label}</span></button>)}</div></div> : null}
            {current.file ? <div className="customerSelectedFile customerStartSelectedFile"><span>{displayFileName(current.file)}</span><button type="button" onClick={() => removeFile(activeView)}>Remove</button></div> : null}
            {current.mode === "upload" && current.file ? <label className={`customerBackgroundRemovalCheck ${current.backgroundRemovalRequested ? "isChecked" : ""}`}><input type="checkbox" checked={current.backgroundRemovalRequested} onChange={(event) => setView(activeView, (state) => ({ ...state, backgroundRemovalRequested: event.target.checked }))} /><span><strong>Please make my logo background transparent</strong><small>Choose this when your logo has a solid-colored or unwanted background. Some logos require vector redraw rather than automatic removal. Any artwork-preparation cost will be included in your quote, and you will approve the finished proof before production.</small></span></label> : null}
            {current.mode === "idea" ? <div className="customerIdeaQuickPrompt"><label className="field"><span>Describe what you want on the {product.viewLabels[activeView].toLowerCase()} *</span><textarea ref={ideaPromptRef} value={current.idea} onChange={(event) => setView(activeView, (state) => ({ ...state, idea: event.target.value }))} maxLength={3000} placeholder="Example: Our business name in bold lettering with a simple tree underneath." /></label><small>Your description stays with the custom request. The box on the mockup is only a placement guide—move and resize it to show where the finished design should go. Moore Made will send a proper proof before anything is made.</small></div> : null}
            <details className="customerOptionalDetails"><summary>+ Add optional details</summary><label className="field"><span>Anything else Moore Made should know?</span><textarea value={current.details} onChange={(event) => setView(activeView, (state) => ({ ...state, details: event.target.value }))} maxLength={2000} placeholder="Colors, wording, style, or anything that may not be obvious from the mockup." /></label></details>
          </section>

          <div className="customerCustomizerWorkspace">
            <div className="customerCustomizerPreviewColumn">
              <div className="customerPreviewToolbar">
                <div className="customerPreviewingLabel"><span>Previewing</span><strong>{product.viewLabels[activeView]}</strong></div>
                <span>{isCustomProduct ? (customItemType.trim() || "Custom item") : colorName} · {coverageLabel(product, coverage)}</span>
              </div>
              {overlay ? <><div className="customerInteractionModes" role="group" aria-label="Choose how to edit the design"><button type="button" className={interactionMode === "move" ? "active" : ""} aria-pressed={interactionMode === "move"} onClick={() => setInteractionMode("move")}><span aria-hidden="true">✥</span><strong>Move</strong><small>Drag the design</small></button><button type="button" className={interactionMode === "resize" ? "active" : ""} aria-pressed={interactionMode === "resize"} onClick={() => setInteractionMode("resize")}><span aria-hidden="true">↔</span><strong>Resize</strong><small>Use corner circles</small></button><button type="button" className={interactionMode === "rotate" ? "active" : ""} aria-pressed={interactionMode === "rotate"} onClick={() => setInteractionMode("rotate")}><span aria-hidden="true">↻</span><strong>Rotate</strong><small>Drag or use 90°</small></button></div>{interactionMode === "rotate" ? <div className="customerRotateQuickActions" role="group" aria-label="Quick rotation controls"><button type="button" onClick={() => setView(activeView, (state) => ({ ...state, rotation: normalizeRotation(state.rotation - 90) }))}><span aria-hidden="true">↶</span><strong>90° left</strong></button><button type="button" disabled={Math.abs(current.rotation) < .01} onClick={() => setView(activeView, (state) => ({ ...state, rotation: 0 }))}><span aria-hidden="true">⟲</span><strong>Reset</strong></button><button type="button" onClick={() => setView(activeView, (state) => ({ ...state, rotation: normalizeRotation(state.rotation + 90) }))}><span aria-hidden="true">↷</span><strong>90° right</strong></button></div> : null}</> : null}
              <div className="customerMockupStage">
                <ProductVisual rootRef={stageRef} kind={product.previewKind} view={activeView} label={activeView === "front" ? "FRONT" : "BACK"} color={selectedColor?.value || "#e6e0d8"} className="customerProductVisual" mockupSettings={mockupSettings}>
                  {overlay ? <div className="customerPrintSafeArea" style={{ left: `${printArea.left}%`, top: `${printArea.top}%`, width: `${printArea.right - printArea.left}%`, height: `${printArea.bottom - printArea.top}%` }} aria-hidden="true"><span>PRINT AREA</span></div> : null}
                  {overlay ? <div className={`customerArtworkLayer isEditable is${interactionMode === "move" ? "Move" : interactionMode === "resize" ? "Resize" : "Rotate"}Mode`} style={{ left: `${current.x}%`, top: `${current.y}%`, width: `${current.width}%`, height: `${current.height}%`, transform: `translate(-50%, -50%) rotate(${current.rotation}deg)` }}>
                    <div className="customerArtworkClip">{overlay}</div>
                    {interactionMode === "move" ? <button className="customerArtworkMoveTarget" type="button" aria-label="Drag to move the design" onPointerDown={onArtworkPointerDown}><span>DRAG</span></button> : (
                      interactionMode === "rotate" ? <button className="customerArtworkMoveTarget customerArtworkRotateTarget" type="button" aria-label="Drag to rotate the design" onPointerDown={onArtworkRotatePointerDown}><span>ROTATE</span></button> : <>
                      <button className="customerArtworkResizeHandle handleNW" type="button" aria-label="Resize design" onPointerDown={onArtworkResizePointerDown} />
                      <button className="customerArtworkResizeHandle handleNE" type="button" aria-label="Resize design" onPointerDown={onArtworkResizePointerDown} />
                      <button className="customerArtworkResizeHandle handleSW" type="button" aria-label="Resize design" onPointerDown={onArtworkResizePointerDown} />
                      <button className="customerArtworkResizeHandle handleSE" type="button" aria-label="Resize design" onPointerDown={onArtworkResizePointerDown} />
                      </>
                    )}
                  </div> : null}
                </ProductVisual>
              </div>
              <div className={`customerPreviewHint ${overlay ? "hasPositionGuide" : ""}`}>{overlay ? <ol className="customerPositionGuide"><li><strong>Choose a mode</strong><span>Use Move, Resize, or Rotate so each gesture only changes one thing.</span></li><li><strong>{interactionMode === "move" ? "Move mode is on" : interactionMode === "resize" ? "Resize mode is on" : "Rotate mode is on"}</strong><span>{interactionMode === "move" ? "Drag anywhere over the design—even when it is small. It stays inside the print area." : interactionMode === "resize" ? "Drag a white corner. The entire image stretches to fit the solid resize box and is never cropped." : "Drag over the design in a circle around its center to turn it."}</span></li><li><strong>Review the proof</strong><span>The print-area box is a guide. Moore Made will confirm exact placement and print quality before production.</span></li></ol> : <span><strong>Your mockup starts blank.</strong> Upload artwork above or describe the design you want Moore Made to create.</span>}</div>
              <div className="customerProductionNotice"><strong>Mockup & handmade production note</strong><span>{CUSTOMER_PRODUCTION_NOTICE}</span></div>
            </div>

            <aside className="customerCustomizerControls">
              <section className="customerControlSection">
                <div className="customerControlNumber">01</div>
                <div className="customerControlContent">
                  <div className="customerControlHeading"><div><h3>{isCustomProduct ? "Item & design sides" : "Design sides"}</h3><p>{isCustomProduct ? "Tell us what the item is, then choose which sides or areas you want designed." : product.supportsBack ? "Choose the front, back, or both before setting up the artwork." : `This product uses the ${product.viewLabels.front.toLowerCase()} design area.`}</p></div><span className="customerLiveBadge">Live preview</span></div>
                  {isCustomProduct ? <label className="field customerCustomItemField"><span>What are you making? *</span><input value={customItemType} onChange={(event) => setCustomItemType(event.target.value)} maxLength={180} placeholder="Example: apron, sign, pillow, gift box…" /></label> : null}
                  {product.supportsBack ? <div className="field"><span className="customerFieldLabel">Design sides</span><div className="customerChoiceGrid three"><button type="button" aria-pressed={coverage === "front"} className={coverage === "front" ? "active" : ""} onClick={() => selectCoverage("front")}>{product.viewLabels.front} only</button><button type="button" aria-pressed={coverage === "back"} className={coverage === "back" ? "active" : ""} onClick={() => selectCoverage("back")}>{product.viewLabels.back} only</button><button type="button" aria-pressed={coverage === "front-back"} className={coverage === "front-back" ? "active" : ""} onClick={() => selectCoverage("front-back")}>Both</button></div>
                    <div className="customerSideSetup">
                      <div><strong>{coverage === "front-back" ? "Both sides selected" : `${coverageLabel(product, coverage)} selected`}</strong><span>{coverage === "front-back" ? "Set up the front and back below before moving to quantities." : "Use the design button below to switch the preview and finish this side."}</span></div>
                      <div className="customerSideSetupButtons">{enabledViews.map((view) => <button key={view} type="button" className={activeView === view ? "active" : ""} onClick={() => { setActiveView(view); setReminder(""); }}><span>{product.viewLabels[view]} design</span><small>{viewIsReady(view) ? "Ready ✓" : "Needs setup"}</small></button>)}</div>
                    </div>
                  </div> : <div className="customerSideSetup"><div><strong>{product.viewLabels.front} design</strong><span>Set up this design below, then choose the product color last.</span></div></div>}
                </div>
              </section>

              <section className="customerControlSection">
                <div className="customerControlNumber">02</div>
                <div className="customerControlContent">
                  <div className="customerControlHeading"><div><h3>{product.viewLabels[activeView]} design</h3><p>There are no preset positions. Put the design exactly where you want it on the mockup.</p></div></div>
                  <div className="customerDirectDesignActions"><label className="btn secondary">{current.file ? "Replace artwork" : "Upload artwork"}<input type="file" hidden accept="image/*,.pdf,.svg" onChange={(event) => { chooseFile(activeView, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button className="btn secondary" type="button" onClick={() => openIdeaPrompt(activeView)}>Describe my idea</button></div>
                  <div className="customerDirectDesignHelp"><strong>Move, resize, and rotate without fighting the controls</strong><span>Choose a mode above the mockup, then drag directly on the design. Rotate also includes 90° left, reset, and 90° right buttons on desktop and mobile.</span></div>
                  {enabledViews.length > 1 ? <div className="customerNextSideRow">{activeView === "front" ? <button type="button" onClick={() => setActiveView("back")}>Next: customize {product.viewLabels.back.toLowerCase()} →</button> : <button type="button" onClick={() => setActiveView("front")}>← Back to {product.viewLabels.front.toLowerCase()}</button>}</div> : null}
                </div>
              </section>

              <section className="customerControlSection">
                <div className="customerControlNumber">03</div>
                <div className="customerControlContent">
                  <div className="customerControlHeading"><div><h3>{isCustomProduct ? "Product color & material" : "Product color"}</h3><p>Choose the product color after your design sides and artwork are set.</p></div></div>
                  <div className="field"><span className="customerFieldLabel">{isCustomProduct ? "Preferred color" : "Product color"}</span><div className="customerColorSwatches">{product.colors.map((color) => {
                    const active = color.name === OTHER_PRODUCT_COLOR ? isOtherProductColor(colorName) : colorName === color.name;
                    return <button key={color.name} type="button" className={`customerColorSwatch ${active ? "active" : ""}`} aria-pressed={active} onClick={() => setPrimaryColor(color.name)} title={color.name}><span className="customerColorDot" style={{ background: color.value }} /><span>{color.name}</span>{active ? <b aria-hidden="true">✓</b> : null}</button>;
                  })}</div>{isOtherProductColor(colorName) ? <label className="customerOtherColor"><span>Preferred color name</span><input autoFocus value={otherProductColorPreference(colorName)} onChange={(event) => setPrimaryColor(event.target.value ? `${OTHER_PRODUCT_COLOR}: ${event.target.value}` : OTHER_PRODUCT_COLOR)} maxLength={100} placeholder="Example: seafoam, rust, or a Jiffy color" /><small>The mockup will display white. Moore Made will confirm the exact product and color before quoting.</small></label> : <small className="customerColorAvailability">Color availability varies by brand and product. Moore Made will confirm the exact blank in your proof and quote.</small>}</div>
                  {isCustomProduct ? <label className="field"><span>Color / material notes <small>Optional</small></span><input value={customColorNotes} onChange={(event) => setCustomColorNotes(event.target.value)} maxLength={240} placeholder="Example: sage green, stainless steel, natural wood…" /></label> : null}
                </div>
              </section>
            </aside>
          </div>
          {reminder ? <div className="customerDesignReminder" role="status"><span className="customerReminderIcon">i</span><div><strong>Quick design reminder</strong><p>{reminder}</p></div></div> : null}
          {error ? <div className="formError" role="alert">{error}</div> : null}
          <div className="customerWizardNav"><span>No prices yet — Moore Made will send your personalized quote after review.</span><button className="btn" type="button" onClick={() => goToStep(2)}>Continue to quantities →</button></div>
        </>
      ) : null}

      {requestStep === 2 ? (
        <section className="customerWizardPanel card">
          {mockupReview("Review your mockup", "Switch between every designed side and color before choosing quantities.")}
          <OrderItemsBuilder items={orderItems} onChange={setOrderItems} primaryProduct={product} allowAdditionalProducts={false} />
          {error ? <div className="formError" role="alert">{error}</div> : null}
          <div className="customerCartStepNote"><strong>Ready to add this design?</strong><span>Your contact, delivery, discount, and final request details are completed once in the cart.</span></div>
          <div className="customerWizardNav"><button className="btn secondary" type="button" onClick={() => goToStep(1)}>← Back to design</button><button className="btn" type="button" disabled={addingToCart} onClick={addCurrentDesignToCart}>{addingToCart ? "Adding to cart…" : "Add this design to cart →"}</button></div>
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
            <label className="field"><span>Fulfillment method</span><select value={delivery} onChange={(event) => setDelivery(event.target.value)}><option value="">Not sure yet</option><option>Local pickup</option><option>Local delivery</option><option>Shipping</option></select></label>
          </div>

          {delivery === "Shipping" || delivery === "Local delivery" ? (
            <div className="shippingAddressPanel">
              <div className="shippingAddressPanelHead"><strong>{delivery === "Local delivery" ? "Delivery address" : "Shipping address"}</strong><span>{delivery === "Local delivery" ? "We’ll use this to plan local delivery and calculate sales tax accurately when your quote is prepared." : "We ship within the United States. We’ll use this for shipping and applicable sales-tax calculations when your quote is prepared."}</span></div>
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
          {mockupReview("Your finished request preview", "Check the front, back, and each selected color before sending your request.")}
          <div className="customerReviewItems">
            {orderItems.map((item, index) => <div className="customerReviewItem" key={item.id}><div><strong>{item.productName}</strong><span>{item.colorName}{index === 0 ? " · primary customized item" : item.designRelationship === "separate" ? " · separate design requested" : " · same design direction"}</span></div><div><strong>{orderItemQuantity(item)} pcs</strong><span>{compactSizeSummary(item)}</span></div></div>)}
          </div>
          <div className="customerReviewFacts">
            <div><span>Design</span><strong>{coverageLabel(product, coverage)}</strong></div>
            <div><span>Contact</span><strong>{name} · {email}</strong></div>
            <div><span>Fulfillment</span><strong>{delivery || "Not sure yet"}</strong></div>
            <div><span>Pricing</span><strong>Personalized quote after review</strong></div>
          </div>
          {delivery === "Shipping" || delivery === "Local delivery" ? <div className="customerReviewAddress"><span>{delivery === "Local delivery" ? "Deliver to" : "Ship to"}</span><strong>{shippingAddress.line1}{shippingAddress.line2 ? `, ${shippingAddress.line2}` : ""}, {shippingAddress.city}, {shippingAddress.state} {shippingAddress.postalCode}</strong></div> : null}
          <div className="customerReviewNotice"><strong>No payment is due now.</strong><span>Moore Made will review your product mix, artwork, supplies, labor, shipping, discount, and applicable tax. You&apos;ll receive a final proof + quote to approve before payment.</span></div>
          <div className="customerTimingSummary" aria-label="Expected reply and production timing"><span><strong>Reply</strong>1–2 business days</span><span><strong>Production</strong>Usually 1+ week after proof approval and payment</span></div>
          {hasCustomerArtwork ? <label className={`artworkRightsCustomerCheck ${artworkRightsAccepted ? "isChecked" : ""}`}>
            <input type="checkbox" checked={artworkRightsAccepted} onChange={(event) => setArtworkRightsAccepted(event.target.checked)} />
            <span><strong>Artwork authorization *</strong><small>{ARTWORK_RIGHTS_UPLOAD_LABEL}</small><em>Moore Made may still pause or refuse artwork that appears unauthorized. <Link href="/terms/custom-orders" target="_blank">Read the custom-order terms ↗</Link></em></span>
          </label> : null}
          {error ? <div className="formError" role="alert">{error}</div> : null}
          <div className="customerWizardNav"><button className="btn secondary" type="button" onClick={() => goToStep(3)}>← Edit contact / delivery</button><button className="btn" type="button" disabled={submitting} onClick={submitCustomization}>{submitting ? "Sending your request…" : "Send request to Moore Made"}</button></div>
        </section>
      ) : null}
    </div>
  );
}
