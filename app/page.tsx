import Link from "next/link";
import { HomeShowcaseCarousel } from "@/components/HomeShowcaseCarousel";
import { getApprovedShowcasePosts } from "@/lib/showcase-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const showcasePosts = await getApprovedShowcasePosts();

  return (
    <>
      <section className="shell heroSingle">
        <div className="heroPanel">
          <div className="eyebrow">Custom goods. Made for you.</div>
          <h1 className="heroTitle">YOUR IDEA.<br /><span>MOORE MADE.</span></h1>
          <p className="heroLead">From shirts and mugs to business cards, bags, coasters, bookmarks, and one-off ideas — tell us what you want and Moore Made will help turn it into something real.</p>
          <div className="heroCategoryLine" aria-label="Popular custom products">
            <span className="ideaItem">Apparel</span><span className="ideaItem">Mugs</span><span className="ideaItem">Business cards</span><span className="ideaItem">Gifts</span><span className="ideaItem">One-off ideas</span>
          </div>
          <div className="heroActionsRow">
            <div className="actions heroActions"><Link className="btn" href="/custom-orders">Place a custom request</Link><Link className="btn secondary" href="/shop">Visit the shop</Link></div>
            <div className="heroStatus heroStatusPill"><span className="statusDot" aria-hidden="true" />Shop is open — customize a product or start with an idea.</div>
          </div>
        </div>
      </section>

      <section className="section processSection">
        <div className="shell">
          <div className="sectionIntro"><div className="eyebrow">Simple custom ordering</div><h2>From idea to finished product</h2><p className="muted processLead">You do not need every detail figured out before reaching out. Send what you know and we can work through the rest together.</p></div>
          <div className="grid processGrid">
            <div className="card processCard"><span className="stepNumber">01</span><h3>Tell us what you need</h3><p className="muted">Share the product, colors, sizes, quantities, deadline, and anything else you already know.</p></div>
            <div className="card processCard"><span className="stepNumber">02</span><h3>Send your artwork</h3><p className="muted">Upload your logo, photo, design, or reference files and tell us the size and placement you want.</p></div>
            <div className="card processCard"><span className="stepNumber">03</span><h3>We make it</h3><p className="muted">We review the details, confirm the order with you, and move it into production.</p></div>
          </div>
        </div>
      </section>

      <section className="section homeShowcaseSection">
        <div className="shell">
          <div className="showcaseSectionHead">
            <div><div className="eyebrow">Made by You</div><h2>See what people are making.</h2><p className="muted">Real Moore Made projects, shared by the people who ordered them.</p></div>
            <Link className="textLink showcaseViewAll" href="/made-by-you">View all reviews →</Link>
          </div>
          <HomeShowcaseCarousel posts={showcasePosts} />
        </div>
      </section>
    </>
  );
}
