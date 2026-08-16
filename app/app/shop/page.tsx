import Link from "next/link";

export default function ShopPage() {
  return (
    <div className="shell">
      <section className="pageHero comingSoonHero">
        <div className="eyebrow">Moore Made shop</div>
        <span className="comingSoonBadge">COMING SOON</span>
        <h1>Our online shop is being made.</h1>
        <p className="lead">
          We&apos;re building an easier way to browse products, choose options,
          upload artwork, and order directly online.
        </p>
        <p className="lead">
          In the meantime, you can still order just about anything. Send us a
          custom request with the item, quantity, sizes, colors, logo, and
          placement details and we&apos;ll take it from there.
        </p>
        <div className="actions">
          <Link className="btn" href="/custom-orders">Place a custom request</Link>
          <Link className="btn secondary" href="/">Back home</Link>
        </div>
      </section>
    </div>
  );
}
