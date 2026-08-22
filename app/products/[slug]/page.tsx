import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerProductCustomizer } from "@/components/shop/CustomerProductCustomizer";
import { ProductVisual } from "@/components/shop/ProductVisual";
import { getCurrentUser } from "@/lib/auth";
import { getProduct } from "@/lib/catalog";
import { getShopMockupTemplates } from "@/lib/mockup-template-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) notFound();

  const mockupTemplates = await getShopMockupTemplates();
  const mockupSettings = mockupTemplates[product.slug];

  const user = await getCurrentUser();
  let profile: { full_name: string | null; phone: string | null } | null = null;
  const savedBusinessLogos: Array<{ id: string; label: string; name: string; url: string }> = [];
  if (user) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("profiles").select("full_name,phone").eq("id", user.id).maybeSingle();
    profile = data;
    const admin = getSupabaseAdmin();
    const { data: logoData } = await admin.from("client_brand_assets").select("id,label,storage_bucket,storage_path,original_filename").eq("customer_user_id", user.id).eq("asset_kind", "logo").order("updated_at", { ascending: false }).limit(10);
    for (const logo of logoData ?? []) {
      const { data: signed } = await admin.storage.from(logo.storage_bucket || "customer-brand-assets").createSignedUrl(logo.storage_path, 60 * 60);
      if (signed?.signedUrl) savedBusinessLogos.push({ id: logo.id, label: logo.label, name: logo.original_filename || logo.label, url: signed.signedUrl });
    }
  }

  return (
    <div className="shell productCustomizePage">
      <section className="pageHero productCustomizeHero">
        <div className="productCustomizeBreadcrumb"><Link href="/shop">Shop</Link><span>→</span><span>{product.category}</span></div>
        <div className="productCustomizeHeroGrid">
          <div>
            <span className="badge">{product.category}</span>
            <h1>{product.name}</h1>
            <p className="lead">{product.description}</p>
            <div className="productCustomizeHeroNotes"><span>1 · Create your mockup</span><span>2 · Add colors and quantities</span><span>3 · Add it to your request cart</span></div>
          </div>
          <ProductVisual kind={product.previewKind} color={product.colors[0]?.value || "#e6e0d8"} label="EXAMPLE PRODUCT" example examplePlacement={product.catalogPreview} mockupSettings={mockupSettings} />
        </div>
      </section>

      {!user ? <div className="productAccountPrompt"><div><strong>Want this connected to your Moore Made account?</strong><span>You can customize as a guest, or sign in first so the request is attached automatically.</span></div><Link className="btn secondary" href={`/account/login?next=/products/${product.slug}`}>Sign in</Link></div> : <div className="productAccountPrompt isSignedIn"><div><strong>Signed in as {user.email}</strong><span>This customization will be attached to your account automatically.</span></div></div>}

      <CustomerProductCustomizer
        product={product}
        initialName={profile?.full_name ?? ""}
        initialEmail={user?.email ?? ""}
        initialPhone={profile?.phone ?? ""}
        mockupSettings={mockupSettings}
        savedBusinessLogos={savedBusinessLogos}
      />
    </div>
  );
}
