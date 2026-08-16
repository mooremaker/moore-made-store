export type Product = {
  slug: string;
  name: string;
  category: string;
  startingPrice: number | null;
  customizable: boolean;
  description: string;
};

export const products: Product[] = [
  { slug: "custom-t-shirts", name: "Custom T-Shirts", category: "Apparel", startingPrice: 18, customizable: true, description: "Upload artwork, choose garment options, quantities, and print placement." },
  { slug: "custom-mugs", name: "Custom Mugs", category: "Drinkware", startingPrice: 14, customizable: true, description: "Personalized mugs for gifts, businesses, teams, and events." },
  { slug: "tote-bags", name: "Custom Tote Bags", category: "Bags", startingPrice: 15, customizable: true, description: "Reusable bags customized with artwork, logos, names, or text." },
  { slug: "business-cards", name: "Business Cards", category: "Business", startingPrice: 25, customizable: true, description: "Upload a finished design or ask Moore Made to help prepare your artwork." },
  { slug: "bookmarks", name: "Custom Bookmarks", category: "Paper Goods", startingPrice: 10, customizable: true, description: "Small-batch custom bookmarks for gifts, schools, events, and businesses." },
  { slug: "coasters", name: "Custom Coasters", category: "Home & Gifts", startingPrice: 16, customizable: true, description: "Personalized coaster sets for homes, weddings, businesses, and gifts." },
  { slug: "stickers", name: "Custom Stickers", category: "Print", startingPrice: 12, customizable: true, description: "Logo, label, event, and decorative stickers in flexible quantities." },
  { slug: "something-else", name: "Something Else?", category: "Custom", startingPrice: null, customizable: true, description: "If you can describe it, send it to us. We'll let you know what we can make." }
];
