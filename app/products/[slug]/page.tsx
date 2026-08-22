import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerProductCustomizer } from "@/components/shop/CustomerProductCustomizer";
import { ProductVisual } from "@/components/shop/ProductVisual";
import { getCurrentUser } from "@/lib/auth";
import { getProduct } from "@/lib/catalog";
import { getShopMockupTemplates } from "@/lib/mockup-template-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) notFound();

  const mockupTemplates = await getShopMockupTemplates();
  const mockupSettings = mockupTemplates[product.slug];

  const user = await getCurrentUser();
  let profile: { full_name: string | null; phone: string | null } | null = null;
  if (user) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("profiles").select("full_name,phone").eq("id", user.id).maybeSingle();
    profile = data;
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
            <div className="productCustomizeHeroNotes"><span>Upload your artwork</span><b>or</b><span>Bring us an idea</span><b>·</b><span>Front/back placement control</span></div>
          </div>
          <ProductVisual kind={product.previewKind} color={product.colors[0]?.value || "#e6e0d8"} label="Example — replace this with yours" example examplePlacement={product.catalogPreview} mockupSettings={mockupSettings} />
        </div>
      </section>

      {!user ? <div className="productAccountPrompt"><div><strong>Want this connected to your Moore Made account?</strong><span>You can customize as a guest, or sign in first so the request is attached automatically.</span></div><Link className="btn secondary" href={`/account/login?next=/products/${product.slug}`}>Sign in</Link></div> : <div className="productAccountPrompt isSignedIn"><div><strong>Signed in as {user.email}</strong><span>This customization will be attached to your account automatically.</span></div></div>}

      <CustomerProductCustomizer
        product={product}
        initialName={profile?.full_name ?? ""}
        initialEmail={user?.email ?? ""}
        initialPhone={profile?.phone ?? ""}
        mockupSettings={mockupSettings}
      />
    </div>
  );
}
