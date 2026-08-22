import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getProduct } from "@/lib/catalog";
import {
  catalogTemplateDocument,
  normalizeCatalogMockupSettings,
} from "@/lib/mockup-template-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("product_mockup_templates")
    .select("id,name,product_key,color_name,visibility,template_document,is_active,created_at,updated_at")
    .eq("visibility", "shop")
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Mockup templates are not available yet. Run the Phase 6.22 Mockup Studio migration in Supabase first." },
      { status: 500 },
    );
  }

  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const productKey = text(body?.productKey, 160);
  const product = getProduct(productKey);
  if (!product) return NextResponse.json({ error: "Choose a valid catalog product." }, { status: 400 });

  const settings = normalizeCatalogMockupSettings(product, body?.settings);
  const supabase = getSupabaseAdmin();
  const { data: existing, error: existingError } = await supabase
    .from("product_mockup_templates")
    .select("id")
    .eq("product_key", product.slug)
    .eq("visibility", "shop")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json(
      { error: "Mockup templates are not available yet. Run the Phase 6.22 Mockup Studio migration in Supabase first." },
      { status: 500 },
    );
  }

  const commonPayload = {
    name: `${product.name} shop default`,
    product_key: product.slug,
    color_name: null,
    visibility: "shop" as const,
    template_document: catalogTemplateDocument(product, settings),
    is_active: true,
  };

  const result = existing?.id
    ? await supabase
        .from("product_mockup_templates")
        .update(commonPayload)
        .eq("id", existing.id)
        .select("id,name,product_key,color_name,visibility,template_document,is_active,created_at,updated_at")
        .single()
    : await supabase
        .from("product_mockup_templates")
        .insert({ ...commonPayload, created_by: auth.user.id })
        .select("id,name,product_key,color_name,visibility,template_document,is_active,created_at,updated_at")
        .single();

  if (result.error) return NextResponse.json({ error: result.error.message || "Could not save the mockup template." }, { status: 500 });

  revalidatePath("/shop");
  revalidatePath(`/products/${product.slug}`);

  return NextResponse.json({ template: result.data });
}
