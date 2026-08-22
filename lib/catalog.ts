export type ProductPreviewKind =
  | "tee"
  | "polo"
  | "hoodie"
  | "mug"
  | "tote"
  | "card"
  | "bookmark"
  | "coaster"
  | "sticker"
  | "custom";

export type ProductColor = {
  name: string;
  value: string;
};

export type PlacementOption = {
  value: string;
  label: string;
  x: number;
  y: number;
  width: number;
};

export type ProductExample = {
  name: string;
  description: string;
  frontPlacement?: string;
  backPlacement?: string;
};

export type ProductCatalogPreview = {
  logoX: number;
  logoY: number;
  logoWidth: number;
  logoRotation?: number;
};

export type Product = {
  slug: string;
  name: string;
  shortName: string;
  category: string;
  startingPrice: number | null;
  customizable: boolean;
  description: string;
  previewKind: ProductPreviewKind;
  colors: ProductColor[];
  sizes: string[];
  supportsBack: boolean;
  viewLabels: { front: string; back: string };
  placements: { front: PlacementOption[]; back: PlacementOption[] };
  defaultPlacements?: { front?: string; back?: string };
  catalogPreview?: ProductCatalogPreview;
  examples: ProductExample[];
};

const apparelColors: ProductColor[] = [
  { name: "White", value: "#f4f2ed" },
  { name: "Black", value: "#252525" },
  { name: "Navy", value: "#26354f" },
  { name: "Heather Gray", value: "#9b9b98" },
  { name: "Forest", value: "#405443" },
  { name: "Royal Blue", value: "#385b91" },
];

const frontApparel: PlacementOption[] = [
  { value: "left-chest", label: "Left chest", x: 61, y: 40, width: 19 },
  { value: "right-chest", label: "Right chest", x: 39, y: 40, width: 19 },
  { value: "center-chest", label: "Center chest", x: 50, y: 40, width: 30 },
  { value: "full-front", label: "Large / full front", x: 50, y: 51, width: 50 },
  { value: "custom-front", label: "Custom placement", x: 50, y: 48, width: 36 },
];

const backApparel: PlacementOption[] = [
  { value: "upper-back", label: "Upper back", x: 50, y: 34, width: 27 },
  { value: "back-center", label: "Back center", x: 50, y: 48, width: 34 },
  { value: "full-back", label: "Large / full back", x: 50, y: 50, width: 45 },
  { value: "custom-back", label: "Custom placement", x: 50, y: 48, width: 30 },
];

const centeredFront: PlacementOption[] = [
  { value: "center", label: "Centered", x: 50, y: 50, width: 42 },
  { value: "small-center", label: "Small centered", x: 50, y: 50, width: 26 },
  { value: "custom", label: "Custom placement", x: 50, y: 50, width: 35 },
];

const centeredBack: PlacementOption[] = [
  { value: "back-center", label: "Centered", x: 50, y: 50, width: 42 },
  { value: "back-small", label: "Small centered", x: 50, y: 50, width: 26 },
  { value: "back-custom", label: "Custom placement", x: 50, y: 50, width: 35 },
];

export const products: Product[] = [
  {
    slug: "custom-t-shirts",
    name: "Custom T-Shirts",
    shortName: "T-Shirts",
    category: "Apparel",
    startingPrice: 18,
    customizable: true,
    description: "Build a shirt your way with your own artwork, photo, or an idea you want Moore Made to create.",
    previewKind: "tee",
    colors: apparelColors,
    sizes: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"],
    supportsBack: true,
    viewLabels: { front: "Front", back: "Back" },
    placements: { front: frontApparel, back: backApparel },
    defaultPlacements: { front: "full-front", back: "full-back" },
    catalogPreview: { logoX: 50, logoY: 50, logoWidth: 33 },
    examples: [
      { name: "Statement front", description: "Large centered front artwork", frontPlacement: "full-front" },
      { name: "Classic business", description: "Small left-chest mark", frontPlacement: "left-chest" },
      { name: "Front + back", description: "Small front logo with a large back design", frontPlacement: "left-chest", backPlacement: "full-back" },
    ],
  },
  {
    slug: "custom-polos",
    name: "Custom Polos",
    shortName: "Polos",
    category: "Apparel",
    startingPrice: 28,
    customizable: true,
    description: "Clean branded polos for teams, staff, businesses, events, and organizations.",
    previewKind: "polo",
    colors: apparelColors,
    sizes: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"],
    supportsBack: true,
    viewLabels: { front: "Front", back: "Back" },
    placements: { front: frontApparel, back: backApparel },
    defaultPlacements: { front: "left-chest", back: "upper-back" },
    catalogPreview: { logoX: 60.5, logoY: 43, logoWidth: 17.5 },
    examples: [
      { name: "Staff uniform", description: "Professional left-chest branding", frontPlacement: "left-chest" },
      { name: "Event crew", description: "Front brand with a larger back identifier", frontPlacement: "left-chest", backPlacement: "upper-back" },
    ],
  },
  {
    slug: "custom-hoodies",
    name: "Custom Crewnecks & Sweatshirts",
    shortName: "Crewnecks",
    category: "Apparel",
    startingPrice: 32,
    customizable: true,
    description: "Classic crewneck sweatshirts with flexible front and back artwork placement.",
    previewKind: "hoodie",
    colors: apparelColors,
    sizes: ["S", "M", "L", "XL", "2XL", "3XL", "4XL"],
    supportsBack: true,
    viewLabels: { front: "Front", back: "Back" },
    placements: { front: frontApparel, back: backApparel },
    defaultPlacements: { front: "full-front", back: "full-back" },
    catalogPreview: { logoX: 50, logoY: 49, logoWidth: 33 },
    examples: [
      { name: "Classic front", description: "Large centered front artwork", frontPlacement: "full-front" },
      { name: "Minimal front", description: "Small chest logo", frontPlacement: "left-chest" },
      { name: "Big back", description: "Small front + statement back", frontPlacement: "left-chest", backPlacement: "full-back" },
    ],
  },
  {
    slug: "custom-mugs",
    name: "Custom Mugs",
    shortName: "Mugs",
    category: "Drinkware",
    startingPrice: 14,
    customizable: true,
    description: "Personalized mugs for gifts, businesses, teams, events, and branded sets.",
    previewKind: "mug",
    colors: [
      { name: "White", value: "#f7f5ef" },
      { name: "Black", value: "#252525" },
      { name: "Navy", value: "#26354f" },
    ],
    sizes: ["Standard mug"],
    supportsBack: true,
    viewLabels: { front: "Side 1", back: "Side 2" },
    placements: { front: centeredFront, back: centeredBack },
    defaultPlacements: { front: "center", back: "back-center" },
    catalogPreview: { logoX: 47, logoY: 50, logoWidth: 34 },
    examples: [
      { name: "Logo mug", description: "Centered brand mark", frontPlacement: "center" },
      { name: "Two-sided", description: "Logo on one side, message on the other", frontPlacement: "center", backPlacement: "back-center" },
    ],
  },
  {
    slug: "tote-bags",
    name: "Custom Tote Bags",
    shortName: "Tote Bags",
    category: "Bags",
    startingPrice: 15,
    customizable: true,
    description: "Reusable bags customized with logos, artwork, names, event graphics, or a design we create with you.",
    previewKind: "tote",
    colors: [
      { name: "Natural", value: "#dfd2b7" },
      { name: "Black", value: "#252525" },
      { name: "White", value: "#f4f2ed" },
    ],
    sizes: ["Standard tote"],
    supportsBack: true,
    viewLabels: { front: "Front", back: "Back" },
    placements: { front: centeredFront, back: centeredBack },
    defaultPlacements: { front: "center", back: "back-center" },
    catalogPreview: { logoX: 50, logoY: 55, logoWidth: 39 },
    examples: [
      { name: "Centered logo", description: "Simple business or event branding", frontPlacement: "center" },
      { name: "Front + back", description: "Artwork on both sides", frontPlacement: "center", backPlacement: "back-center" },
    ],
  },
  {
    slug: "business-cards",
    name: "Business Cards",
    shortName: "Business Cards",
    category: "Business",
    startingPrice: 25,
    customizable: true,
    description: "Start with finished artwork or describe what you need and let Moore Made turn it into a polished card.",
    previewKind: "card",
    colors: [{ name: "Full color", value: "#f2eee6" }],
    sizes: ["Standard 3.5 × 2 in"],
    supportsBack: true,
    viewLabels: { front: "Front", back: "Back" },
    placements: { front: centeredFront, back: centeredBack },
    defaultPlacements: { front: "center", back: "back-center" },
    catalogPreview: { logoX: 43, logoY: 47, logoWidth: 28, logoRotation: -3 },
    examples: [
      { name: "Logo front", description: "Brand-first front with details on back", frontPlacement: "center", backPlacement: "back-center" },
      { name: "Single-sided", description: "Everything on one clean face", frontPlacement: "center" },
    ],
  },
  {
    slug: "bookmarks",
    name: "Custom Bookmarks",
    shortName: "Bookmarks",
    category: "Paper Goods",
    startingPrice: 10,
    customizable: true,
    description: "Small-batch bookmarks for gifts, schools, businesses, promotions, and events.",
    previewKind: "bookmark",
    colors: [{ name: "Full color", value: "#eee8df" }],
    sizes: ["Standard bookmark"],
    supportsBack: true,
    viewLabels: { front: "Front", back: "Back" },
    placements: { front: centeredFront, back: centeredBack },
    defaultPlacements: { front: "center", back: "back-center" },
    catalogPreview: { logoX: 50, logoY: 50, logoWidth: 62 },
    examples: [
      { name: "Brand bookmark", description: "Logo or graphic centered on the front", frontPlacement: "center" },
      { name: "Two-sided", description: "Artwork front with text or details on back", frontPlacement: "center", backPlacement: "back-center" },
    ],
  },
  {
    slug: "coasters",
    name: "Custom Coasters",
    shortName: "Coasters",
    category: "Home & Gifts",
    startingPrice: 16,
    customizable: true,
    description: "Personalized coaster sets for homes, weddings, businesses, events, and gifts.",
    previewKind: "coaster",
    colors: [
      { name: "White", value: "#f4f2ed" },
      { name: "Natural", value: "#cdbb9e" },
    ],
    sizes: ["Standard coaster"],
    supportsBack: false,
    viewLabels: { front: "Top", back: "Back" },
    placements: { front: centeredFront, back: [] },
    defaultPlacements: { front: "center" },
    catalogPreview: { logoX: 50, logoY: 50, logoWidth: 34 },
    examples: [{ name: "Centered design", description: "Logo, monogram, or event art", frontPlacement: "center" }],
  },
  {
    slug: "stickers",
    name: "Custom Stickers",
    shortName: "Stickers",
    category: "Print",
    startingPrice: 12,
    customizable: true,
    description: "Logo, label, event, packaging, and decorative stickers in flexible quantities.",
    previewKind: "sticker",
    colors: [{ name: "Full color", value: "#f2eee6" }],
    sizes: ["Small", "Medium", "Large", "Custom size"],
    supportsBack: false,
    viewLabels: { front: "Design", back: "Back" },
    placements: { front: centeredFront, back: [] },
    defaultPlacements: { front: "center" },
    catalogPreview: { logoX: 50, logoY: 50, logoWidth: 36, logoRotation: -6 },
    examples: [{ name: "Logo sticker", description: "Your brand or artwork fills the sticker", frontPlacement: "center" }],
  },
  {
    slug: "something-else",
    name: "Something Else?",
    shortName: "Something Else",
    category: "Custom",
    startingPrice: null,
    customizable: true,
    description: "If you can describe it, send it to us. We’ll let you know what we can make and help you plan the design.",
    previewKind: "custom",
    colors: [
      { name: "White", value: "#f4f2ed" },
      { name: "Black", value: "#252525" },
      { name: "Navy", value: "#26354f" },
      { name: "Red", value: "#8b3f3f" },
      { name: "Natural", value: "#dfd2b7" },
      { name: "Not sure", value: "#e6e0d8" },
    ],
    sizes: ["Custom"],
    supportsBack: true,
    viewLabels: { front: "Main view", back: "Additional view" },
    placements: { front: centeredFront, back: centeredBack },
    defaultPlacements: { front: "center", back: "back-center" },
    catalogPreview: { logoX: 50, logoY: 50, logoWidth: 30 },
    examples: [{ name: "Start with an idea", description: "Choose the closest layout and tell us what you imagine", frontPlacement: "center" }],
  },
];

export const productCategories = ["All", ...Array.from(new Set(products.map((product) => product.category)))];

export function getProduct(slug: string) {
  return products.find((product) => product.slug === slug) ?? null;
}
