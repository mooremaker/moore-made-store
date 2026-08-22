import { products } from "@/lib/catalog";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  catalogSettingsFromTemplateDocument,
  type ProductMockupTemplateRecord,
  type ShopMockupTemplateMap,
} from "@/lib/mockup-template-types";

export async function getShopMockupTemplates(): Promise<ShopMockupTemplateMap> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("product_mockup_templates")
      .select("id,name,product_key,color_name,visibility,template_document,is_active,created_at,updated_at")
      .eq("visibility", "shop")
      .eq("is_active", true)
      .order("updated_at", { ascending: false });

    if (error) return {};

    const result: ShopMockupTemplateMap = {};
    const rows = (data ?? []) as ProductMockupTemplateRecord[];
    for (const row of rows) {
      if (!row.product_key || result[row.product_key]) continue;
      const product = products.find((item) => item.slug === row.product_key);
      if (!product) continue;
      result[row.product_key] = catalogSettingsFromTemplateDocument(product, row.template_document);
    }
    return result;
  } catch {
    return {};
  }
}
