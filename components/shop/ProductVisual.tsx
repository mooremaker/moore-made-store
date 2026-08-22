import Image from "next/image";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, Ref } from "react";
import type { ProductPreviewKind } from "@/lib/catalog";
import type { CatalogMockupSettings } from "@/lib/mockup-template-types";

type Props = {
  kind: ProductPreviewKind;
  color: string;
  label?: string;
  example?: boolean;
  examplePlacement?: {
    logoX: number;
    logoY: number;
    logoWidth: number;
    logoRotation?: number;
  };
  mockupSettings?: CatalogMockupSettings;
  children?: ReactNode;
  className?: string;
  rootRef?: Ref<HTMLDivElement>;
  editable?: boolean;
  selectedLayer?: "product" | "logo" | null;
  onProductPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onLogoPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onLogoResizePointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

function ApparelShape({ kind }: { kind: "tee" | "polo" | "hoodie" }) {
  if (kind === "tee") {
    return (
      <svg className="productVisualGarment" viewBox="0 0 320 300" aria-hidden="true">
        <path
          className="productVisualGarmentFill"
          d="M111 55c12-4 22-8 31-13 5 8 11 12 18 12s13-4 18-12c9 5 19 9 31 13l49 29-24 39-27-16 4 139H109l4-139-27 16-24-39 49-29Z"
        />
        <path className="productVisualGarmentSeam" d="M142 42c3 13 9 19 18 19s15-6 18-19" />
        <path className="productVisualGarmentSeam soft" d="M113 107 109 246M207 107l4 139" />
      </svg>
    );
  }

  if (kind === "polo") {
    return (
      <svg className="productVisualGarment" viewBox="0 0 320 300" aria-hidden="true">
        <path
          className="productVisualGarmentFill"
          d="M111 57c13-5 23-9 31-15 6 7 12 11 18 11s12-4 18-11c8 6 18 10 31 15l48 29-24 38-27-16 4 138H110l4-138-27 16-24-38 48-29Z"
        />
        <path className="productVisualGarmentDetail" d="m139 45 21 18-15 17-22-25 16-10Zm42 0-21 18 15 17 22-25-16-10Z" />
        <path className="productVisualGarmentSeam" d="M160 63v47" />
        <circle className="productVisualGarmentButton" cx="160" cy="77" r="2.4" />
        <circle className="productVisualGarmentButton" cx="160" cy="89" r="2.4" />
        <circle className="productVisualGarmentButton" cx="160" cy="101" r="2.4" />
        <path className="productVisualGarmentSeam soft" d="M114 108 110 246M206 108l4 138" />
      </svg>
    );
  }

  return (
    <svg className="productVisualGarment" viewBox="0 0 320 300" aria-hidden="true">
      <path
        className="productVisualGarmentFill"
        d="M112 55c12-4 22-8 30-13 5 8 11 12 18 12s13-4 18-12c8 5 18 9 30 13l37 18 37 101-31 12-37-73 5 128H101l5-128-37 73-31-12L75 73l37-18Z"
      />
      <path className="productVisualGarmentSeam" d="M142 42c3 13 9 19 18 19s15-6 18-19" />
      <path className="productVisualGarmentRib" d="M101 226h118v18H101zM42 164l31 12-6 16-31-12 6-16Zm236 0-31 12 6 16 31-12-6-16Z" />
      <path className="productVisualGarmentSeam soft" d="M106 113 101 241M214 113l5 128" />
    </svg>
  );
}

export function ProductVisual({
  kind,
  color,
  label,
  example = false,
  examplePlacement,
  mockupSettings,
  children,
  className = "",
  rootRef,
  editable = false,
  selectedLayer = null,
  onProductPointerDown,
  onLogoPointerDown,
  onLogoResizePointerDown,
}: Props) {
  const style = { "--product-preview-color": color } as CSSProperties;
  const isApparel = kind === "tee" || kind === "polo" || kind === "hoodie";
  const productStyle: CSSProperties | undefined = mockupSettings ? {
    left: `${mockupSettings.productX}%`,
    top: `${mockupSettings.productY}%`,
    transform: `translate(-50%, -50%) scale(${mockupSettings.productScale}) rotate(${mockupSettings.productRotation}deg)`,
  } : undefined;

  const placement = mockupSettings ? {
    logoX: mockupSettings.logoX,
    logoY: mockupSettings.logoY,
    logoWidth: mockupSettings.logoWidth,
    logoRotation: mockupSettings.logoRotation,
  } : examplePlacement;

  const exampleStyle: CSSProperties | undefined = placement ? {
    left: `${placement.logoX}%`,
    top: `${placement.logoY}%`,
    width: `${placement.logoWidth}%`,
    transform: `translate(-50%, -50%) rotate(${placement.logoRotation ?? 0}deg)`,
  } : undefined;

  return (
    <div ref={rootRef} className={`productVisual productVisual-${kind} ${editable ? "productVisualEditable" : ""} ${className}`.trim()} style={style}>
      <div
        className={`productVisualBaseLayer ${editable && selectedLayer === "product" ? "isSelected" : ""}`}
        style={productStyle}
        onPointerDown={onProductPointerDown}
      >
        {isApparel ? (
          <ApparelShape kind={kind} />
        ) : (
          <div className="productVisualShape" aria-hidden="true">
            {kind === "mug" ? <span className="productVisualHandle" /> : null}
            {kind === "tote" ? <span className="productVisualToteHandle" /> : null}
            {kind === "custom" ? <span className="productVisualCustomMark">+</span> : null}
          </div>
        )}
      </div>
      {example ? (
        <div
          className={`productVisualExampleMark productVisualExampleMark-${kind} ${editable && selectedLayer === "logo" ? "isSelected" : ""}`}
          style={exampleStyle}
          aria-hidden={editable ? undefined : "true"}
          onPointerDown={onLogoPointerDown}
        >
          {kind === "card" ? (
            <div className="productVisualCardExample">
              <Image src="/moore-made-logo.png" alt="" width={150} height={66} />
              <span className="productVisualCardRule" />
              <span className="productVisualCardText productVisualCardTextLong" />
              <span className="productVisualCardText" />
            </div>
          ) : (
            <Image src="/moore-made-logo.png" alt="" width={150} height={66} />
          )}
          {editable && selectedLayer === "logo" ? (
            <button
              className="productVisualResizeHandle"
              type="button"
              aria-label="Resize logo"
              onPointerDown={onLogoResizePointerDown}
            />
          ) : null}
        </div>
      ) : null}
      {children}
      {label ? <span className="productVisualLabel">{label}</span> : null}
    </div>
  );
}
