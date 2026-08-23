"use client";

import { isOtherProductColor, OTHER_PRODUCT_COLOR, otherProductColorPreference, products, type Product } from "@/lib/catalog";
import { compactSizeSummary, orderItemQuantity, orderItemsQuantity, type StructuredOrderItem } from "@/lib/order-types";

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function productFor(slug: string) {
  return products.find((product) => product.slug === slug) ?? products[0];
}

function initialQuantities(product: Product, count = 1) {
  const quantities: Record<string, number> = {};
  for (const size of product.sizes) quantities[size] = 0;
  const preferred = product.sizes.find((size) => size === "M") || product.sizes[0] || "Each";
  quantities[preferred] = count;
  return quantities;
}

export function makeStructuredOrderItem(product: Product, colorName?: string, relationship: StructuredOrderItem["designRelationship"] = "same"): StructuredOrderItem {
  return {
    id: newId(),
    productSlug: product.slug,
    productName: product.name,
    colorName: colorName || product.colors[0]?.name || "Default",
    quantities: initialQuantities(product),
    notes: "",
    designRelationship: relationship,
  };
}

export function OrderItemsBuilder({
  items,
  onChange,
  primaryProduct,
  allowAdditionalProducts = true,
}: {
  items: StructuredOrderItem[];
  onChange: (items: StructuredOrderItem[]) => void;
  primaryProduct: Product;
  allowAdditionalProducts?: boolean;
}) {
  const total = orderItemsQuantity(items);

  function patchItem(id: string, patch: Partial<StructuredOrderItem>) {
    onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function setQty(item: StructuredOrderItem, size: string, value: number) {
    patchItem(item.id, {
      quantities: {
        ...item.quantities,
        [size]: Math.max(0, Math.min(100000, Math.floor(value || 0))),
      },
    });
  }

  function changeProduct(item: StructuredOrderItem, slug: string) {
    const next = productFor(slug);
    patchItem(item.id, {
      productSlug: next.slug,
      productName: next.name,
      colorName: next.colors[0]?.name || "Default",
      quantities: initialQuantities(next),
    });
  }

  function addColor() {
    const source = items[0] || makeStructuredOrderItem(primaryProduct, primaryProduct.colors[0]?.name, "primary");
    const p = productFor(source.productSlug);
    const unused = p.colors.find((color) => !items.some((item) => item.productSlug === p.slug && (color.name === OTHER_PRODUCT_COLOR ? isOtherProductColor(item.colorName) : item.colorName === color.name)));
    const next = makeStructuredOrderItem(p, unused?.name || p.colors[0]?.name, "same");
    onChange([...items, next]);
  }

  function addProduct() {
    const candidate = products.find((product) => product.slug !== primaryProduct.slug) || primaryProduct;
    onChange([...items, makeStructuredOrderItem(candidate, candidate.colors[0]?.name, "same")]);
  }

  return (
    <div className="orderItemsBuilder compactOrderItemsBuilder">
      <div className="orderItemsBuilderHead">
        <div>
          <div className="eyebrow">Quantity & product mix</div>
          <h2>What should we make?</h2>
          <p>Each color is summarized below. Tap a row to expand it and edit the product, color, sizes, or quantities.</p>
        </div>
      </div>

      <div className="orderItemCards">
        {items.map((item, index) => {
          const itemProduct = productFor(item.productSlug);
          const quantity = orderItemQuantity(item);
          const isPrimary = index === 0;
          return (
            <details className={`orderItemCard ${isPrimary ? "isPrimary" : ""}`} key={item.id}>
              <summary className="orderItemCardHead">
                <div className="orderItemCardIdentity">
                  <span className="orderItemNumber">{String(index + 1).padStart(2, "0")}</span>
                  <div className="orderItemCardSummary">
                    <div className="orderItemCardTitleRow"><strong>{isPrimary ? "Main customized item" : "Additional item"}</strong><span>{quantity} piece{quantity === 1 ? "" : "s"}</span></div>
                    {compactSizeSummary(item) ? <small>{compactSizeSummary(item)}</small> : <small>Choose sizes below</small>}
                  </div>
                </div>
                <span className="orderItemDisclosure"><b>Edit</b></span>
              </summary>

              <div className="orderItemCardBody">
                {!isPrimary ? <div className="orderItemRemoveRow"><button type="button" className="orderItemRemove" onClick={() => onChange(items.filter((row) => row.id !== item.id))}>Remove this color</button></div> : null}
                <div className="orderItemSetupGrid compactOrderItemSetup">
                  <label className="field">
                    <span>Product</span>
                    {isPrimary ? <div className="orderItemLockedField"><div>{primaryProduct.name}</div></div> : (
                      <select value={item.productSlug} onChange={(event) => changeProduct(item, event.target.value)}>
                        {products.filter((product) => product.customizable).map((product) => <option value={product.slug} key={product.slug}>{product.name}</option>)}
                      </select>
                    )}
                  </label>
                  <label className="field">
                    <span>Color</span>
                    <select value={isOtherProductColor(item.colorName) ? OTHER_PRODUCT_COLOR : item.colorName} onChange={(event) => patchItem(item.id, { colorName: event.target.value })}>
                      {itemProduct.colors.map((color) => <option key={color.name} value={color.name}>{color.name}</option>)}
                    </select>
                    {isOtherProductColor(item.colorName) ? <span className="orderItemOtherColor"><input aria-label={`Preferred color for ${item.productName}`} value={otherProductColorPreference(item.colorName)} onChange={(event) => patchItem(item.id, { colorName: event.target.value ? `${OTHER_PRODUCT_COLOR}: ${event.target.value}` : OTHER_PRODUCT_COLOR })} maxLength={100} placeholder="Type the preferred color" /><small>White will be used in the mockup until the exact blank is confirmed.</small></span> : null}
                  </label>
                </div>

                <div className="compactSizeSection">
                  <div className="compactSizeSectionHead"><strong>Sizes & quantities</strong><small>Use + / − or type the number.</small></div>
                  <div className="sizeQuantityMatrix compactSizeMatrix" aria-label={`Sizes for ${itemProduct.name}`}>
                    {itemProduct.sizes.map((size) => {
                      const qty = Math.max(0, Number(item.quantities[size] || 0));
                      return (
                        <div className={`sizeQuantityRow compactSizeRow ${qty > 0 ? "hasQuantity" : ""}`} key={size}>
                          <span className="sizeQuantityLabel">{size}</span>
                          <div className="quantityStepper">
                            <button type="button" onClick={() => setQty(item, size, qty - 1)} aria-label={`Remove one ${size}`}>−</button>
                            <input aria-label={`${size} quantity`} type="number" min="0" max="100000" step="1" value={qty} onChange={(event) => setQty(item, size, Number(event.target.value))} />
                            <button type="button" onClick={() => setQty(item, size, qty + 1)} aria-label={`Add one ${size}`}>+</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {!isPrimary ? (
                  <div className="additionalItemDesignChoice">
                    <span>Artwork / design</span>
                    <div className="customerChoiceGrid two">
                      <button type="button" className={item.designRelationship !== "separate" ? "active" : ""} aria-pressed={item.designRelationship !== "separate"} onClick={() => patchItem(item.id, { designRelationship: "same" })}>Same design direction</button>
                      <button type="button" className={item.designRelationship === "separate" ? "active" : ""} aria-pressed={item.designRelationship === "separate"} onClick={() => patchItem(item.id, { designRelationship: "separate" })}>Different design</button>
                    </div>
                    {item.designRelationship === "separate" ? <label className="field"><span>What should be different?</span><textarea value={item.notes || ""} onChange={(event) => patchItem(item.id, { notes: event.target.value })} maxLength={2000} placeholder="Example: Manager polos use only the small logo on the chest; no back print." /></label> : null}
                  </div>
                ) : null}
              </div>
            </details>
          );
        })}
      </div>

      <div className="orderItemsAddRow compactOrderItemsAddRow">
        <div className="orderItemsAddButtons"><button type="button" className="btn secondary" onClick={addColor}>+ Another color</button>{allowAdditionalProducts ? <button type="button" className="btn secondary" onClick={addProduct}>+ Another product</button> : null}</div>
        <div className="orderItemsTotal isInline"><strong>{total}</strong><span>total piece{total === 1 ? "" : "s"}</span></div>
      </div>
    </div>
  );
}
