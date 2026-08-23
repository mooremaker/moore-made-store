"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ProductVisual } from "@/components/shop/ProductVisual";
import { OrderItemsBuilder } from "@/components/shop/OrderItemsBuilder";
import { ARTWORK_RIGHTS_POLICY_VERSION, ARTWORK_RIGHTS_UPLOAD_LABEL } from "@/lib/artwork-rights";
import { CUSTOMER_PRODUCTION_NOTICE } from "@/lib/customer-production-notice";
import { findProductColor, getProduct, isOtherProductColor, otherProductColorPreference } from "@/lib/catalog";
import {
  activeSavedRequestCartId,
  clearCustomRequestCart,
  getCustomRequestCart,
  removeCustomRequestCartItem,
  replaceCustomRequestCart,
  setActiveSavedRequestCartId,
  updateCustomRequestCartItem,
  type AccountSavedRequestCart,
  type CustomRequestCartItem,
} from "@/lib/custom-request-cart";
import { formatRequestNumber } from "@/lib/custom-request-types";
import { compactSizeSummary, orderItemQuantity, orderItemsQuantity, type ShippingAddress } from "@/lib/order-types";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

const BUCKET = "custom-request-files";
const SAVED_CART_BUCKET = "request-cart-files";
const MAX_FILES = 20;

const blankAddress: ShippingAddress = { name: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "US" };

function filePreviewable(file: File) {
  return file.type.startsWith("image/") || /\.svg$/i.test(file.name);
}

function CartItemMockup({ item }: { item: CustomRequestCartItem }) {
  const product = getProduct(item.productSlug);
  const enabledViews = item.views.filter((view) => view.enabled);
  const [viewIndex, setViewIndex] = useState(0);
  const colorNames = Array.from(new Set(item.orderItems.filter((row) => row.productSlug === item.productSlug).map((row) => row.colorName)));
  const [colorName, setColorName] = useState(colorNames[0] || item.colorName);
  const view = enabledViews[viewIndex] || enabledViews[0];
  const color = findProductColor(product, colorName);
  const localPreviewUrl = useMemo(() => view?.file && filePreviewable(view.file) ? URL.createObjectURL(view.file) : null, [view?.file]);
  const previewUrl = localPreviewUrl || view?.savedFile?.url || null;

  useEffect(() => () => { if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl); }, [localPreviewUrl]);
  useEffect(() => { if (viewIndex >= enabledViews.length) setViewIndex(0); }, [enabledViews.length, viewIndex]);

  if (!product || !view) return null;

  const artwork = view.mode === "idea"
    ? <div className="customerIdeaPlaceholder" aria-label="Placement area for the design Moore Made will create">{view.width >= 22 && view.height >= 12 ? <strong>DESIGN AREA</strong> : null}</div>
    : previewUrl
      ? <img src={previewUrl} alt={`${item.productName} ${item.viewLabels[view.view]} artwork`} draggable={false} />
      : <div className="customerArtworkFilePlaceholder"><strong>ARTWORK</strong><span>{view.file?.name || view.savedFile?.name || "Uploaded file"}</span></div>;

  function move(direction: -1 | 1) {
    setViewIndex((current) => (current + direction + enabledViews.length) % enabledViews.length);
  }

  return (
    <div className="cartItemMockup">
      <div className="cartItemMockupStage">
        {enabledViews.length > 1 ? <button type="button" className="customerMockupArrow previous" onClick={() => move(-1)} aria-label="Show previous side">←</button> : null}
        <ProductVisual kind={item.previewKind} view={view.view} label={view.view === "front" ? "FRONT" : "BACK"} color={color?.value || "#e6e0d8"} className="cartProductVisual" mockupSettings={item.mockupSettings}>
          <div className="customerArtworkLayer customerReviewArtworkLayer" style={{ left: `${view.x}%`, top: `${view.y}%`, width: `${view.width}%`, height: `${view.height}%`, transform: `translate(-50%, -50%) rotate(${view.rotation}deg)` }}>{artwork}</div>
        </ProductVisual>
        {enabledViews.length > 1 ? <button type="button" className="customerMockupArrow next" onClick={() => move(1)} aria-label="Show next side">→</button> : null}
      </div>
      <div className="cartMockupControls">
        <div className="customerMockupViewTabs">{enabledViews.map((option, index) => <button key={option.view} type="button" className={index === viewIndex ? "active" : ""} onClick={() => setViewIndex(index)}>{item.viewLabels[option.view]}</button>)}</div>
        {colorNames.length > 1 ? <div className="customerMockupColorPicker">{colorNames.map((name) => {
          const option = findProductColor(product, name);
          return <button key={name} type="button" className={name === colorName ? "active" : ""} onClick={() => setColorName(name)}><span style={{ background: option?.value || "#e6e0d8" }} />{name}</button>;
        })}</div> : <span className="customerMockupSingleColor"><i style={{ background: color?.value || "#e6e0d8" }} />{colorName}</span>}
      </div>
      {view.mode === "idea" && view.idea.trim() ? <div className="customerIdeaSummary"><strong>Design idea</strong><p>{view.idea}</p></div> : null}
      {view.mode === "upload" && view.backgroundRemovalRequested ? <div className="customerBackgroundRemovalSummary"><strong>Transparent background requested</strong><span>Any artwork-preparation cost will be included in the quote.</span></div> : null}
    </div>
  );
}

export function CustomRequestCartCheckout({ initialName = "", initialEmail = "", initialPhone = "", signedIn = false }: { initialName?: string; initialEmail?: string; initialPhone?: string; signedIn?: boolean }) {
  const [items, setItems] = useState<CustomRequestCartItem[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ requestNumber: number | string; uploadWarning: boolean; emailWarning: boolean; mockupWarning: boolean } | null>(null);
  const [savedCarts, setSavedCarts] = useState<AccountSavedRequestCart[]>([]);
  const [savedCartsLoading, setSavedCartsLoading] = useState(signedIn);
  const [savedCartId, setSavedCartId] = useState<string | null>(null);
  const [savedCartName, setSavedCartName] = useState("");
  const [savingCart, setSavingCart] = useState(false);
  const [savedCartMessage, setSavedCartMessage] = useState("");

  useEffect(() => {
    let alive = true;
    getCustomRequestCart()
      .then(async (localItems) => {
        if (!alive) return;
        setItems(localItems);
        if (!signedIn) return;
        const carts = await fetchAccountCarts();
        if (!alive) return;
        setSavedCarts(carts);
        const activeId = activeSavedRequestCartId();
        const active = carts.find((cart) => cart.id === activeId) || null;
        if (active) {
          setSavedCartId(active.id);
          setSavedCartName(active.name);
          if (!localItems.length) {
            await replaceCustomRequestCart(active.items);
            if (alive) setItems(active.items);
          } else {
            const refreshedLocalItems = localItems.map((localItem) => {
              const savedItem = active.items.find((item) => item.id === localItem.id);
              if (!savedItem) return localItem;
              return { ...localItem, views: localItem.views.map((localView) => {
                const savedView = savedItem.views.find((view) => view.view === localView.view);
                return localView.savedFile?.path && savedView?.savedFile?.path === localView.savedFile.path
                  ? { ...localView, savedFile: savedView.savedFile }
                  : localView;
              }) };
            });
            await replaceCustomRequestCart(refreshedLocalItems);
            if (alive) setItems(refreshedLocalItems);
          }
        }
      })
      .catch(() => setError("Could not open your saved request cart on this device."))
      .finally(() => { if (alive) { setLoading(false); setSavedCartsLoading(false); } });
    return () => { alive = false; };
  }, [signedIn]);

  async function fetchAccountCarts() {
    const response = await fetch("/api/account/request-carts", { cache: "no-store" });
    if (response.status === 401) return [] as AccountSavedRequestCart[];
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load saved carts.");
    return Array.isArray(result.carts) ? result.carts as AccountSavedRequestCart[] : [];
  }

  async function refreshAccountCarts(preferredId?: string) {
    const carts = await fetchAccountCarts();
    setSavedCarts(carts);
    const selected = carts.find((cart) => cart.id === (preferredId || savedCartId));
    if (selected) {
      setSavedCartId(selected.id);
      setSavedCartName(selected.name);
      setActiveSavedRequestCartId(selected.id);
    }
    return carts;
  }

  async function openSavedCart(cart: AccountSavedRequestCart) {
    if (items.length && savedCartId !== cart.id && !window.confirm(`Open “${cart.name}”? Your current unsaved cart on this device will be replaced.`)) return;
    await replaceCustomRequestCart(cart.items);
    setItems(cart.items);
    setSavedCartId(cart.id);
    setSavedCartName(cart.name);
    setActiveSavedRequestCartId(cart.id);
    setSavedCartMessage(`Opened “${cart.name}”.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteSavedCart(cart: AccountSavedRequestCart) {
    if (!window.confirm(`Delete the saved cart “${cart.name}”? This will not delete any request you already submitted.`)) return;
    const response = await fetch("/api/account/request-carts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cartId: cart.id }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error || "Could not delete this saved cart."); return; }
    if (savedCartId === cart.id) {
      setSavedCartId(null);
      setActiveSavedRequestCartId(null);
    }
    setSavedCarts((current) => current.filter((row) => row.id !== cart.id));
    setSavedCartMessage(`Deleted “${cart.name}”.`);
  }

  function cartUuid() {
    return crypto.randomUUID();
  }

  async function saveCurrentCart(asNew = false) {
    if (!signedIn) return;
    if (!items.length) { setError("Add at least one design before saving this cart."); return; }
    const name = savedCartName.trim();
    if (!name) { setError("Give this saved cart a name first."); return; }
    setSavingCart(true);
    setError("");
    setSavedCartMessage("");
    const cartId = !asNew && savedCartId ? savedCartId : cartUuid();
    try {
      const uploadEntries = (await Promise.all(items.flatMap((item) => item.views.filter((view) => view.enabled && (view.file || (asNew && view.savedFile?.url))).map(async (view) => {
        if (view.file) return { item, view, file: view.file };
        const savedFile = view.savedFile;
        if (!savedFile?.url) return null;
        const response = await fetch(savedFile.url);
        if (!response.ok) throw new Error(`Could not copy ${savedFile.name}. Reopen this saved cart and try again.`);
        const blob = await response.blob();
        return { item, view, file: new File([blob], savedFile.name, { type: savedFile.type || blob.type }) };
      })))).filter((entry): entry is { item: CustomRequestCartItem; view: CustomRequestCartItem["views"][number]; file: File } => Boolean(entry));
      const pathByIndex = new Map<number, string>();
      if (uploadEntries.length) {
        const prepareResponse = await fetch("/api/account/request-carts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare_uploads", cartId, files: uploadEntries.map(({ item, view, file }) => ({ itemId: item.id, view: view.view, name: file.name, type: file.type, size: file.size })) }) });
        const prepared = await prepareResponse.json();
        if (!prepareResponse.ok) throw new Error(prepared.error || "Could not prepare your artwork for saving.");
        const supabase = getSupabaseBrowser();
        for (const target of Array.isArray(prepared.targets) ? prepared.targets : []) {
          const entry = uploadEntries[target.index];
          if (!entry) continue;
          const { error: uploadError } = await supabase.storage.from(SAVED_CART_BUCKET).uploadToSignedUrl(target.path, target.token, entry.file, { contentType: entry.file.type || undefined });
          if (uploadError) throw new Error(`Could not save ${entry.file.name}. Please try again.`);
          pathByIndex.set(target.index, target.path);
        }
        if (pathByIndex.size !== uploadEntries.length) throw new Error("One or more artwork files could not be saved.");
      }
      const uploadIndexByView = new Map<string, number>();
      uploadEntries.forEach((entry, index) => uploadIndexByView.set(`${entry.item.id}:${entry.view.view}`, index));
      const storedItems = items.map((item) => ({
        ...item,
        views: item.views.map((view) => {
          const uploadIndex = uploadIndexByView.get(`${item.id}:${view.view}`);
          const path = uploadIndex === undefined ? null : pathByIndex.get(uploadIndex) || null;
          const uploadedFile = uploadIndex === undefined ? null : uploadEntries[uploadIndex]?.file || null;
          return {
            ...view,
            file: null,
            savedFile: path ? { path, name: uploadedFile?.name || "Artwork", type: uploadedFile?.type || "", size: uploadedFile?.size || 0 } : view.savedFile ? { path: view.savedFile.path, name: view.savedFile.name, type: view.savedFile.type, size: view.savedFile.size } : null,
          };
        }),
      }));
      const saveResponse = await fetch("/api/account/request-carts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", cartId, name, items: storedItems }) });
      const saved = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(saved.error || "Could not save this cart.");
      const carts = await refreshAccountCarts(cartId);
      const refreshed = carts.find((cart) => cart.id === cartId);
      if (refreshed) {
        await replaceCustomRequestCart(refreshed.items);
        setItems(refreshed.items);
      }
      setSavedCartMessage(asNew || !savedCartId ? `Saved “${name}” as a new cart.` : `Updated “${name}”.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this cart.");
    } finally {
      setSavingCart(false);
    }
  }

  const totalQuantity = items.reduce((sum, item) => sum + orderItemsQuantity(item.orderItems), 0);
  const reorderSourceIds = Array.from(new Set(items.map((item) => item.reorderSourceRequestId).filter((value): value is string => Boolean(value))));
  const isLockedReorder = items.length > 0 && reorderSourceIds.length === 1 && items.every((item) => item.reorderSourceRequestId === reorderSourceIds[0]);
  const reorderSourceRequestId = isLockedReorder ? reorderSourceIds[0] : null;
  const artworkEntries = items.flatMap((item) => item.views.filter((view) => view.enabled && view.mode === "upload" && (view.file || view.savedFile)).map((view) => ({ item, view })));
  const hasArtwork = artworkEntries.length > 0;

  async function removeItem(id: string) {
    await removeCustomRequestCartItem(id);
    setItems(await getCustomRequestCart());
  }

  async function updateItemQuantities(item: CustomRequestCartItem, orderItems: CustomRequestCartItem["orderItems"]) {
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, orderItems, colorName: orderItems[0]?.colorName || row.colorName } : row));
    try {
      await updateCustomRequestCartItem(item.id, { orderItems, colorName: orderItems[0]?.colorName || item.colorName });
    } catch {
      setError("Could not save the updated sizes and quantities on this device.");
    }
  }

  async function startFreshCart() {
    if (items.length && !window.confirm("Start a fresh cart? Make sure you saved this cart first if you want to keep it.")) return;
    await clearCustomRequestCart();
    setItems([]);
    setSavedCartId(null);
    setSavedCartName("");
    setActiveSavedRequestCartId(null);
    setSavedCartMessage("Your saved carts are still available below.");
    setError("");
  }

  function validate() {
    if (!items.length) return "Add at least one customized product to your cart.";
    if (reorderSourceIds.length || items.some((item) => item.reorderSourceRequestId)) {
      if (!isLockedReorder) return "Submit the completed-order reorder by itself so its original price stays protected.";
    }
    if (items.some((item) => orderItemsQuantity(item.orderItems) < 1)) return "Choose at least one size and quantity for every design in your cart.";
    if (items.some((item) => item.orderItems.some((row) => isOtherProductColor(row.colorName) && !otherProductColorPreference(row.colorName).trim()))) return "Enter the preferred color for every item marked Other.";
    if (artworkEntries.length > MAX_FILES) return `Please keep the request to ${MAX_FILES} artwork files or fewer.`;
    if (!name.trim()) return "Please enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Please enter a valid email address.";
    if ((delivery === "Shipping" || delivery === "Local delivery") && (!shippingAddress.line1.trim() || !shippingAddress.city.trim() || !shippingAddress.state.trim() || !shippingAddress.postalCode.trim())) {
      return `Please complete the ${delivery === "Shipping" ? "shipping" : "delivery"} address.`;
    }
    if (hasArtwork && !artworkRightsAccepted) return "Please confirm that you own the uploaded artwork or have permission to use it.";
    return "";
  }

  async function submitRequest() {
    const validation = validate();
    if (validation) { setError(validation); return; }
    setSubmitting(true);
    setError("");

    const orderItems = items.flatMap((cartItem) => cartItem.orderItems.map((row) => ({ ...row, id: `${cartItem.id}-${row.id}` })));
    const productSummary = items.length === 1 ? items[0].productName : `${items[0].productName} + ${items.length - 1} more custom design${items.length === 2 ? "" : "s"}`;
    const colorSummary = orderItems.map((item) => `${item.productName}: ${item.colorName}`).join(" · ");
    const sizeSummary = orderItems.map((item) => `${item.productName} ${item.colorName}: ${compactSizeSummary(item) || `${orderItemQuantity(item)} each`}`).join(" | ");
    const instructions = items.flatMap((item, itemIndex) => item.views.filter((view) => view.enabled).map((view) => `${itemIndex + 1}. ${item.productName} — ${item.viewLabels[view.view]}: ${view.mode === "idea" ? `design needed: ${view.idea}` : `uploaded artwork: ${view.file?.name || view.savedFile?.name || "file"}`}; placement: ${view.placementLabel || "Custom placement"}.${view.mode === "upload" && view.backgroundRemovalRequested ? " BACKGROUND REMOVAL REQUESTED — make the uploaded artwork background transparent; use vector redraw/vectorization instead of unsafe automatic enhancement when needed; include the artwork-preparation cost in the quote and send the finished proof for approval." : ""}${view.details ? ` Optional details: ${view.details}` : ""}`)).join("\n");

    try {
      const fileEntries = await Promise.all(artworkEntries.map(async ({ item, view }) => {
        if (view.file) return { item, view, file: view.file };
        const savedFile = view.savedFile;
        if (!savedFile?.url) throw new Error(`The saved copy of ${savedFile?.name || "your artwork"} needs to be refreshed. Reopen this saved cart and try again.`);
        const savedResponse = await fetch(savedFile.url);
        if (!savedResponse.ok) throw new Error(`Could not open ${savedFile.name}. Reopen this saved cart and try again.`);
        const blob = await savedResponse.blob();
        return { item, view, file: new File([blob], savedFile.name, { type: savedFile.type || blob.type }) };
      }));
      const response = await fetch("/api/custom-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), email: email.trim(), phone: phone.trim(), smsConsent: Boolean(phone.trim()) && smsConsent,
          reorderSourceRequestId,
          product: productSummary, quantity: totalQuantity, orderItems,
          itemType: items.map((item) => item.customItemType || item.productName).join(" · "), colors: colorSummary, sizes: sizeSummary,
          logoSize: items.flatMap((item) => item.views.filter((view) => view.enabled).map((view) => `${item.productName} ${item.viewLabels[view.view]} ${Math.round(view.width)}% preview width`)).join(" · "),
          printSides: items.map((item) => `${item.productName}: ${item.coverageLabel}`).join(" · "),
          placements: items.flatMap((item) => item.views.filter((view) => view.enabled).map((view) => view.placement)), artworkInstructions: instructions,
          deadline, delivery, shippingAddress: delivery === "Shipping" || delivery === "Local delivery" ? { ...shippingAddress, name: shippingAddress.name.trim() || name.trim() } : null,
          notes: notes.trim(), discountCode: discountCode.trim(), artworkRightsAccepted: hasArtwork ? artworkRightsAccepted : false,
          artworkRightsPolicyVersion: hasArtwork ? ARTWORK_RIGHTS_POLICY_VERSION : null, website: "",
          files: fileEntries.map(({ file }) => ({ name: file.name, size: file.size, type: file.type })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not submit your request.");

      const supabase = getSupabaseBrowser();
      const pathByIndex = new Map<number, string>();
      let uploadWarning = false;
      for (const target of Array.isArray(result.uploads) ? result.uploads : []) {
        const entry = fileEntries[target.index];
        if (!entry?.file) continue;
        const { error: uploadError } = await supabase.storage.from(BUCKET).uploadToSignedUrl(target.path, target.token, entry.file, { contentType: entry.file.type || undefined });
        if (uploadError) uploadWarning = true;
        else pathByIndex.set(target.index, target.path);
      }
      if (pathByIndex.size !== fileEntries.length) uploadWarning = fileEntries.length > 0;

      if (uploadWarning) {
        throw new Error("We could not finish uploading every artwork file. The request was not finalized as artwork-ready, so please retry the upload before leaving this page.");
      }

      const uploadedPaths = Array.from(pathByIndex.entries()).sort((a, b) => a[0] - b[0]).map(([, path]) => path);
      const fileIndex = new Map<string, number>();
      fileEntries.forEach((entry, index) => fileIndex.set(`${entry.item.id}:${entry.view.view}`, index));
      const mockupDocument = {
        version: 2, source: "customer", productSlug: null, productName: productSummary, colorName: null, previewKind: null,
        activeViewId: `${items[0].id}-${items[0].views.find((view) => view.enabled)?.view || "front"}`,
        views: items.flatMap((item) => {
          const product = getProduct(item.productSlug);
          const itemColor = findProductColor(product, item.colorName);
          return item.views.filter((view) => view.enabled).map((view) => {
            const uploadIndex = fileIndex.get(`${item.id}:${view.view}`);
            const path = uploadIndex === undefined ? null : pathByIndex.get(uploadIndex) || null;
            return {
              id: `${item.id}-${view.view}`, name: `${item.productName} · ${item.viewLabels[view.view]}`, base: null,
              layers: path ? [{ id: `${item.id}-${view.view}-artwork`, asset: { path, originalName: view.file?.name || view.savedFile?.name || "Customer artwork", bucket: BUCKET }, x: view.x, y: view.y, width: view.width, height: view.height, rotation: view.rotation, opacity: 1, zIndex: 1 }] : [],
              customerIntent: { enabled: true, source: view.mode, placement: view.placement, placementLabel: view.placementLabel, idea: view.mode === "idea" ? view.idea : "", details: view.details, artworkFileName: view.mode === "upload" ? view.file?.name || view.savedFile?.name || "" : "", backgroundRemovalRequested: view.mode === "upload" ? Boolean(view.backgroundRemovalRequested) : false, x: view.x, y: view.y, width: view.width, height: view.height, rotation: view.rotation },
              template: { productSlug: item.productSlug, productName: item.productName, previewKind: item.previewKind, colorName: item.colorName, colorValue: itemColor?.value || "#e6e0d8", viewKey: view.view },
            };
          });
        }),
      };

      const filesResponse = await fetch(`/api/custom-requests/${result.requestId}/files`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionToken: result.submissionToken, paths: uploadedPaths, expectedUploadCount: fileEntries.length, mockupDocument }) });
      const filesResult = await filesResponse.json().catch(() => ({}));
      if (!filesResponse.ok) throw new Error(filesResult.error || "The artwork file could not be confirmed. Please retry the upload before leaving this page.");

      if (savedCartId) {
        await fetch("/api/account/request-carts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cartId: savedCartId }) }).catch(() => null);
        setSavedCarts((current) => current.filter((cart) => cart.id !== savedCartId));
      }
      await clearCustomRequestCart();
      setActiveSavedRequestCartId(null);
      setSavedCartId(null);
      setItems([]);
      setSuccess({ requestNumber: result.requestNumber, uploadWarning, emailWarning: Boolean(result.emailWarning), mockupWarning: Boolean(filesResult.mockupWarning) });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Could not submit your request.");
    } finally {
      setSubmitting(false);
    }
  }

  function savedCartsPanel() {
    if (!signedIn) {
      return <aside className="guestSaveCartPrompt"><div><strong>Want to save this cart for later?</strong><span>Your cart stays in this browser automatically. Sign in to name it and open it on another device.</span></div><Link className="btn secondary" href="/account/login?next=/cart">Sign in to save cart</Link></aside>;
    }
    return (
      <section className="accountSavedCartsPanel card">
        <div className="savedCartPanelHead"><div><div className="eyebrow">Saved carts</div><h2>Keep more than one project.</h2><p>Name each cart separately, then reopen, update, or delete it whenever you need.</p></div>{savedCartId ? <span>Editing: {savedCartName}</span> : null}</div>
        {items.length ? <div className="savedCartEditor"><label className="field"><span>Cart name *</span><input value={savedCartName} onChange={(event) => setSavedCartName(event.target.value)} placeholder="Example: Smith Family Reunion" maxLength={120} /></label><div className="savedCartEditorActions"><button type="button" className="btn" disabled={savingCart} onClick={() => saveCurrentCart(false)}>{savingCart ? "Saving…" : savedCartId ? "Update this saved cart" : "Save this cart"}</button>{savedCartId ? <button type="button" className="btn secondary" disabled={savingCart} onClick={() => saveCurrentCart(true)}>Save as a new cart</button> : null}<button type="button" className="btn secondary" disabled={savingCart} onClick={startFreshCart}>Start a fresh cart</button></div></div> : null}
        {savedCartMessage ? <div className="savedCartMessage" role="status">{savedCartMessage}</div> : null}
        {savedCartsLoading ? <p className="savedCartLoading">Loading your saved carts…</p> : savedCarts.length ? <div className="savedCartList">{savedCarts.map((cart) => <article key={cart.id} className={cart.id === savedCartId ? "isActive" : ""}><div><strong>{cart.name}</strong><span>{cart.items.length} design{cart.items.length === 1 ? "" : "s"} · Updated {new Date(cart.updatedAt).toLocaleDateString()}</span></div><div className="savedCartActions"><button type="button" onClick={() => openSavedCart(cart)}>{cart.id === savedCartId ? "Open" : "Open cart"}</button><button type="button" className="danger" onClick={() => deleteSavedCart(cart)}>Delete</button></div></article>)}</div> : <p className="savedCartLoading">You do not have any named carts yet.</p>}
      </section>
    );
  }

  if (loading) return <div className="card cartLoading">Loading your request cart…</div>;
  if (success) return <section className="card customerCustomizerSuccess"><div className="successMark">✓</div><div className="eyebrow">Request received</div><h2>Your full request is with Moore Made.</h2><p>Your reference is <strong>{formatRequestNumber(success.requestNumber)}</strong>. Every product, quantity, color, mockup, and uploaded artwork file was included together.</p>{success.uploadWarning ? <p className="requestWarning">The request was saved, but one or more artwork files may need to be sent again.</p> : null}{success.mockupWarning ? <p className="requestWarning">Your request and placement details are saved, but the editable admin mockup copy may need attention.</p> : null}{success.emailWarning ? <p className="requestWarning">Your request is saved, but the confirmation email may not have sent.</p> : null}<div className="actions"><Link className="btn" href="/account">View my account</Link><Link className="btn secondary" href="/shop">Back to shop</Link></div></section>;
  if (!items.length) return <div className="requestCartEmptyLayout">{savedCartsPanel()}<div className="empty requestCartEmpty"><h2>Your current cart is empty.</h2><p>Create a new mockup or open one of your named saved carts above.</p><Link className="btn" href="/shop">Browse products</Link></div></div>;

  return (
    <div className="requestCartCheckout">
      <section className="requestCartItems">
        {savedCartsPanel()}
        <div className="requestCartSectionHead"><div><div className="eyebrow">Your designs</div><h2>Review everything you&apos;re requesting.</h2><p>Tap a design to expand it, then review its front, back, colors, sizes, and quantities.</p></div><span>{items.length} design{items.length === 1 ? "" : "s"} · {totalQuantity} piece{totalQuantity === 1 ? "" : "s"}</span></div>
        {isLockedReorder ? <div className="customerReorderLockNotice"><strong>Original completed-order price protected</strong><span>Items, quantities, unit prices, fees, discounts, and payment terms stay exactly the same. You may change only pickup/delivery/shipping; Moore Made will then recalculate shipping and sales tax if needed.</span></div> : null}
        {items.map((item, index) => {
          const itemProduct = getProduct(item.productSlug);
          const itemQuantity = orderItemsQuantity(item.orderItems);
          return <details className="requestCartItem card" key={item.id}><summary className="requestCartItemSummary"><div><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.productName}</h3><p>{item.coverageLabel}</p><small>{item.orderItems.map((row) => row.colorName).join(" · ")}</small></div></div><span className="requestCartItemDisclosure"><strong>{itemQuantity}</strong> piece{itemQuantity === 1 ? "" : "s"}</span></summary><div className="requestCartItemBody">{!isLockedReorder ? <div className="requestCartItemActions"><button type="button" onClick={() => removeItem(item.id)}>Remove this design</button></div> : null}<CartItemMockup item={item} /><div className="requestCartQuantityGroups">{item.orderItems.map((row) => <div key={row.id}><div><strong>{row.colorName}</strong><span>{orderItemQuantity(row)} piece{orderItemQuantity(row) === 1 ? "" : "s"}</span></div><p>{compactSizeSummary(row)}</p></div>)}</div>{itemProduct && !isLockedReorder ? <details className="requestCartQuantityEditor"><summary>Edit sizes, quantities, or colors</summary><div><OrderItemsBuilder items={item.orderItems} onChange={(nextItems) => void updateItemQuantities(item, nextItems)} primaryProduct={itemProduct} allowAdditionalProducts={false} /></div></details> : null}</div></details>;
        })}
        {!isLockedReorder ? <Link className="btn secondary requestCartAddMore" href="/shop">+ Add another custom product</Link> : null}
      </section>

      <section className="requestCartDetails card">
        <div className="requestCartSectionHead"><div><div className="eyebrow">Contact & delivery</div><h2>Where should we send your proof and quote?</h2><p>No payment is taken when you submit this request.</p></div></div>
        <div className="customerOrderGrid">
          <label className="field"><span>Name *</span><input value={name} onChange={(event) => { setName(event.target.value); if (!shippingAddress.name) setShippingAddress((address) => ({ ...address, name: event.target.value })); }} autoComplete="name" /></label>
          <label className="field"><span>Email *</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
          <label className="field"><span>Phone <small>Optional</small></span><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" /></label>
          <label className={`customerSmsConsent ${phone.trim() ? "" : "isDisabled"}`}><input type="checkbox" checked={smsConsent} onChange={(event) => setSmsConsent(event.target.checked)} disabled={!phone.trim()} /><span><strong>Text updates</strong><small>{phone.trim() ? "Yes, Moore Made may text me about this order." : "Add a phone number to enable text updates."}</small></span></label>
          <label className="field"><span>Needed by <small>Optional</small></span><input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
          <label className="field"><span>Fulfillment method</span><select value={delivery} onChange={(event) => setDelivery(event.target.value)}><option value="">Not sure yet</option><option>Local pickup</option><option>Local delivery</option><option>Shipping</option></select></label>
        </div>
        {delivery === "Shipping" || delivery === "Local delivery" ? <div className="shippingAddressPanel"><div className="shippingAddressPanelHead"><strong>{delivery === "Local delivery" ? "Delivery address" : "Shipping address"}</strong><span>{delivery === "Local delivery" ? "We’ll use this to plan delivery and calculate sales tax accurately." : "We ship within the United States. We’ll use this for shipping and applicable sales-tax calculations."}</span></div><div className="customerOrderGrid"><label className="field"><span>Recipient</span><input value={shippingAddress.name} onChange={(event) => setShippingAddress((address) => ({ ...address, name: event.target.value }))} /></label><label className="field"><span>Street address *</span><input value={shippingAddress.line1} onChange={(event) => setShippingAddress((address) => ({ ...address, line1: event.target.value }))} /></label><label className="field"><span>Apt / suite <small>Optional</small></span><input value={shippingAddress.line2} onChange={(event) => setShippingAddress((address) => ({ ...address, line2: event.target.value }))} /></label><label className="field"><span>City *</span><input value={shippingAddress.city} onChange={(event) => setShippingAddress((address) => ({ ...address, city: event.target.value }))} /></label><label className="field"><span>State *</span><input value={shippingAddress.state} onChange={(event) => setShippingAddress((address) => ({ ...address, state: event.target.value.toUpperCase().slice(0, 2) }))} maxLength={2} placeholder="OH" /></label><label className="field"><span>ZIP *</span><input value={shippingAddress.postalCode} onChange={(event) => setShippingAddress((address) => ({ ...address, postalCode: event.target.value }))} /></label><label className="field"><span>Country *</span><select value={shippingAddress.country} onChange={(event) => setShippingAddress((address) => ({ ...address, country: event.target.value }))}><option value="US">United States</option></select></label></div></div> : null}
        <div className="customerOrderGrid requestFinalDetails"><label className="field"><span>Discount code <small>{isLockedReorder ? "Original preserved" : "Optional"}</small></span><input value={isLockedReorder ? "" : discountCode} onChange={(event) => setDiscountCode(event.target.value.toUpperCase())} placeholder={isLockedReorder ? "Locked to completed order" : "Example: FAMILY10"} disabled={isLockedReorder} /></label><label className="field"><span>Anything else? <small>Optional</small></span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Budget, event details, special requests, inspiration, or anything else we should know." /></label></div>
        {hasArtwork ? <label className={`artworkRightsCustomerCheck ${artworkRightsAccepted ? "isChecked" : ""}`}><input type="checkbox" checked={artworkRightsAccepted} onChange={(event) => setArtworkRightsAccepted(event.target.checked)} /><span><strong>Artwork authorization *</strong><small>{ARTWORK_RIGHTS_UPLOAD_LABEL}</small><em>Moore Made may pause artwork that appears unauthorized. <Link href="/terms/custom-orders" target="_blank">Read the custom-order terms ↗</Link></em></span></label> : null}
        <div className="customerReviewNotice"><strong>No payment is due now.</strong><span>Moore Made will review the full cart and send one organized proof + personalized quote for approval.</span></div>
        <div className="customerTimingSummary" aria-label="Expected reply and production timing"><span><strong>Reply</strong>1–2 business days</span><span><strong>Production</strong>Usually 1+ week after proof approval and payment</span></div>
        <div className="customerProductionNotice"><strong>Mockup & handmade production note</strong><span>{CUSTOMER_PRODUCTION_NOTICE}</span></div>
        {error ? <div className="formError" role="alert">{error}</div> : null}
        <button className="btn requestCartSubmit" type="button" disabled={submitting} onClick={submitRequest}>{submitting ? "Sending your full request…" : "Send full request to Moore Made →"}</button>
      </section>
    </div>
  );
}
