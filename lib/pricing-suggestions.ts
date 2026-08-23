export type StarterPricingSuggestion = {
  blankCostCents: number;
  printCostCents: number;
  additionalLocationCostCents: number;
  packagingCostCents: number;
  minimumProfitPerItemCents: number;
  targetMarginBasisPoints: number;
  sizeBlankCostsCents: Record<string, number>;
  sizeCustomerSurchargesCents: Record<string, number>;
};

const DEFAULT: StarterPricingSuggestion = {
  blankCostCents: 0,
  printCostCents: 0,
  additionalLocationCostCents: 0,
  packagingCostCents: 0,
  minimumProfitPerItemCents: 0,
  targetMarginBasisPoints: 5000,
  sizeBlankCostsCents: {},
  sizeCustomerSurchargesCents: {},
};

const APPAREL_SURCHARGES = { "2XL": 400, "3XL": 700, "4XL": 800, "5XL": 800 };

const STARTERS: Record<string, StarterPricingSuggestion> = {
  "custom-t-shirts": { blankCostCents: 325, printCostCents: 350, additionalLocationCostCents: 350, packagingCostCents: 50, minimumProfitPerItemCents: 1200, targetMarginBasisPoints: 5000, sizeBlankCostsCents: { XS: 249, S: 325, M: 325, L: 325, XL: 325, "2XL": 598, "3XL": 807, "4XL": 838, "5XL": 838 }, sizeCustomerSurchargesCents: APPAREL_SURCHARGES },
  "custom-polos": { blankCostCents: 1200, printCostCents: 350, additionalLocationCostCents: 350, packagingCostCents: 50, minimumProfitPerItemCents: 0, targetMarginBasisPoints: 5000, sizeBlankCostsCents: {}, sizeCustomerSurchargesCents: APPAREL_SURCHARGES },
  "custom-hoodies": { blankCostCents: 1200, printCostCents: 400, additionalLocationCostCents: 400, packagingCostCents: 75, minimumProfitPerItemCents: 0, targetMarginBasisPoints: 5000, sizeBlankCostsCents: {}, sizeCustomerSurchargesCents: APPAREL_SURCHARGES },
  "custom-mugs": { blankCostCents: 350, printCostCents: 250, additionalLocationCostCents: 250, packagingCostCents: 100, minimumProfitPerItemCents: 0, targetMarginBasisPoints: 5000, sizeBlankCostsCents: {}, sizeCustomerSurchargesCents: {} },
  "tote-bags": { blankCostCents: 300, printCostCents: 300, additionalLocationCostCents: 300, packagingCostCents: 50, minimumProfitPerItemCents: 0, targetMarginBasisPoints: 5000, sizeBlankCostsCents: {}, sizeCustomerSurchargesCents: {} },
  "business-cards": { blankCostCents: 1200, printCostCents: 0, additionalLocationCostCents: 0, packagingCostCents: 50, minimumProfitPerItemCents: 0, targetMarginBasisPoints: 5000, sizeBlankCostsCents: {}, sizeCustomerSurchargesCents: {} },
  "bookmarks": { blankCostCents: 100, printCostCents: 100, additionalLocationCostCents: 100, packagingCostCents: 25, minimumProfitPerItemCents: 0, targetMarginBasisPoints: 5000, sizeBlankCostsCents: {}, sizeCustomerSurchargesCents: {} },
  "coasters": { blankCostCents: 250, printCostCents: 250, additionalLocationCostCents: 250, packagingCostCents: 50, minimumProfitPerItemCents: 0, targetMarginBasisPoints: 5000, sizeBlankCostsCents: {}, sizeCustomerSurchargesCents: {} },
  "stickers": { blankCostCents: 75, printCostCents: 100, additionalLocationCostCents: 100, packagingCostCents: 25, minimumProfitPerItemCents: 0, targetMarginBasisPoints: 5000, sizeBlankCostsCents: {}, sizeCustomerSurchargesCents: {} },
};

export function starterPricingFor(productSlug: string): StarterPricingSuggestion {
  return STARTERS[productSlug] || DEFAULT;
}
