import Link from "next/link";
import { ShopCatalog } from "@/components/shop/ShopCatalog";
import { getShopMockupTemplates } from "@/lib/mockup-template-server";

export default async function ShopPage() {
  const mockupTemplates = await getShopMockupTemplates();
  return (
    <div className="shell shopPage">
      <section className="pageHero shopHero">
        <div className="eyebrow">Moore Made shop</div>
        <h1 className="shopHeroTitle">
          <span className="shopHeroTitleQuestion">See something you like?</span>
          <span className="shopHeroTitleAnswer">Make it yours.</span>
        </h1>
        <p className="lead">
          Browse what we can make, choose your colors and placement, then upload your own artwork or tell us the idea you want created. You stay in control of the look from the beginning.
        </p>
        <div className="shopHeroPaths">
          <div className="shopHeroPathInfo"><strong>I have artwork</strong><span>Upload it, place it, resize it, and show us exactly what you have in mind.</span></div>
          <div className="shopHeroPathInfo"><strong>I have an idea</strong><span>Pick the product and layout anyway. Tell us what belongs in each spot and we&apos;ll help create it.</span></div>
        </div>
        <div className="actions">
          <a className="btn" href="#catalog">Browse the catalog</a>
          <Link className="btn secondary" href="/custom-orders">Start a general request</Link>
        </div>
      </section>

      <section className="shopCatalogSection" id="catalog">
        <div className="sectionHead shopSectionHead">
          <div><div className="eyebrow">Choose a canvas</div><h2>What do you want to make?</h2></div>
          <p>Use each example as inspiration, then replace it with your artwork.</p>
        </div>
        <ShopCatalog mockupTemplates={mockupTemplates} />
      </section>
    </div>
  );
}
