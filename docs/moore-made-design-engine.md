# Moore Made Design Engine

## What changed

New customer designs save an editable `DesignDocumentV2` in the existing `mockup_projects.document` JSONB record. The existing version-1 `views` remain beside it as a compatibility projection, so existing orders, proofs, saved carts, and admin screens continue to work.

The version-2 document owns:

- product, variant, blank color, and `2d` / `3d` rendering mode;
- front, back, and future sleeve/product surfaces;
- normalized print areas and physical print dimensions;
- ordered image, editable text, and editable drawing layers;
- original source asset references (never a mockup screenshot);
- transforms, placements, intended print size, effective PPI, and quality rating;
- artwork-improvement requests;
- a separate customer-proof manifest and production manifest.

Combined carts may save `designDocuments[]`, one editable document per product. `designEngine` is also populated for a single-product design.

## Rendering architecture

The current `ProductVisual` remains the 2D adapter. `StarterGarment3D` is the first WebGL adapter. Both consume the same placement and layer values.

The starter apparel renderer includes:

- procedural T-shirt, polo, and crewneck geometry;
- realistic directional/ambient lighting and garment roughness;
- dynamic blank recoloring without flattening highlights or shadows;
- curved front/back artwork surfaces attached to the rotating garment;
- explicit Front / Back buttons;
- an opt-in Rotate Product gesture so ordinary mobile swipes still scroll.

These procedural garments are intentionally starter mockups. Replace them with manufacturer-specific GLB models and calibrated UV maps for exact seams, folds, sleeves, sizing, and wraparound products.

## Print-quality calculation

Quality is calculated from the original pixel dimensions and intended physical print dimensions:

`effective PPI = min(source width px / print width in, source height px / print height in)`

Ratings are Excellent (300+), Good (200–299), Fair (150–199), and Poor (below 150). DPI metadata is not treated as proof of printable quality.

## Data compatibility

- No destructive migration of old mockups is performed.
- Existing version-1 order/mockup documents still load.
- New customer submissions are sanitized into version-1 views, then the server reconstructs the trusted version-2 production document from those sanitized views.
- Proof PNGs remain reference images only. Original uploads and editable vector/text/drawing data remain the production sources.

## Setup and future assets

No new database column is required because `mockup_projects.document` and `product_mockup_templates.template_document` are already JSONB. The existing `supabase/moore_made_phase6_22_mockup_studio.sql` migration must already be installed.

No new environment variables are required. The existing Supabase variables are still required to run the application and complete a full static build.

For production 3D, Moore Made still needs:

1. Licensed/manufacturer-approved GLB garment models.
2. Calibrated front/back/sleeve UV regions and print-area measurements for every blank/size.
3. A Supabase storage bucket plus an admin model-upload workflow when GLBs are ready.
4. Licensed web/production font files or an outline-at-production policy.
5. Calibrated wrap surfaces for mugs and tumblers.

## Intentionally staged next work

The shared document supports multiple ordered layers and the customer can create multiple text/drawing layers. The current compatibility UI still accepts one original uploaded artwork file per product side; supporting several separately uploaded files on the same side requires upgrading the saved-cart file replication/upload protocol rather than storing only another browser preview. That should be the next data-safe phase.

Sleeve surfaces and placement presets are present in product configuration, but the customer surface tabs remain Front / Back until real sleeve UV maps or calibrated sleeve blanks are available.
