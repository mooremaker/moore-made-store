"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { productCategories, products } from "@/lib/catalog";
import type { ShopMockupTemplateMap } from "@/lib/mockup-template-types";
import { ProductVisual } from "@/components/shop/ProductVisual";

export function ShopCatalog({ mockupTemplates = {} }: { mockupTemplates?: ShopMockupTemplateMap }) {
  const [category, setCategory] = useState("All");
  const visible = useMemo(
    () => category === "All" ? products : products.filter((product) => product.category === category),
    [category]
  );

  return (
    <>
      <div className="shopCategoryBar" aria-label="Filter shop categories">
        {productCategories.map((item) => (
          <button
            key={item}
            type="button"
            className={category === item ? "active" : ""}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="shopCatalogGrid">
        {visible.map((product) => {
          const color = product.colors[0]?.value ?? "#e6e0d8";
          return (
            <article className="shopProductCard" key={product.slug}>
              <Link className="shopProductPreviewLink" href={`/products/${product.slug}`} aria-label={`Customize ${product.name}`}>
                <ProductVisual
                  kind={product.previewKind}
                  color={color}
                  label="Example layout"
                  example
                  examplePlacement={product.catalogPreview}
                  mockupSettings={mockupTemplates[product.slug]}
                />
              </Link>
              <div className="shopProductCardBody">
                <h2>{product.name}</h2>
                <p>{product.description}</p>
                <Link className="btn shopCustomizeButton" href={`/products/${product.slug}`}>Customize this</Link>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
