export type StarterPricingSuggestion = {
  blankCostCents: number;
  printCostCents: number;
  packagingCostCents: number;
  laborHours: number;
  targetMarginBasisPoints: number;
};

const DEFAULT: StarterPricingSuggestion = {
  blankCostCents: 0,
  printCostCents: 0,
  packagingCostCents: 0,
  laborHours: 1,
  targetMarginBasisPoints: 5000,
};

const STARTERS: Record<string, StarterPricingSuggestion> = {
  "custom-t-shirts": { blankCostCents: 450, printCostCents: 350, packagingCostCents: 50, laborHours: 1, targetMarginBasisPoints: 5000 },
  "custom-polos": { blankCostCents: 1200, printCostCents: 350, packagingCostCents: 50, laborHours: 1, targetMarginBasisPoints: 5000 },
  "custom-hoodies": { blankCostCents: 1200, printCostCents: 400, packagingCostCents: 75, laborHours: 1, targetMarginBasisPoints: 5000 },
  "custom-mugs": { blankCostCents: 350, printCostCents: 250, packagingCostCents: 100, laborHours: 1, targetMarginBasisPoints: 5000 },
  "tote-bags": { blankCostCents: 300, printCostCents: 300, packagingCostCents: 50, laborHours: 1, targetMarginBasisPoints: 5000 },
  "business-cards": { blankCostCents: 1200, printCostCents: 0, packagingCostCents: 50, laborHours: 1, targetMarginBasisPoints: 5000 },
  "bookmarks": { blankCostCents: 100, printCostCents: 100, packagingCostCents: 25, laborHours: 1, targetMarginBasisPoints: 5000 },
  "coasters": { blankCostCents: 250, printCostCents: 250, packagingCostCents: 50, laborHours: 1, targetMarginBasisPoints: 5000 },
  "stickers": { blankCostCents: 75, printCostCents: 100, packagingCostCents: 25, laborHours: 1, targetMarginBasisPoints: 5000 },
};

export function starterPricingFor(productSlug: string): StarterPricingSuggestion {
  return STARTERS[productSlug] || DEFAULT;
}
