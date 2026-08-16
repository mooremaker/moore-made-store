import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <>
      <section className="shell hero">
        <div>
          <div className="eyebrow">Custom goods. Made for you.</div>
          <h1>YOUR IDEA.<br />MOORE MADE.</h1>
          <p className="lead">
            From shirts and mugs to business cards, bags, coasters, bookmarks,
            and one-off ideas — tell us what you want and Moore Made will help
            turn it into something real.
          </p>
          <div className="actions">
            <Link className="btn" href="/custom-orders">Place a custom request</Link>
            <Link className="btn secondary" href="/shop">Visit the shop</Link>
          </div>
        </div>

        <div className="heroCard logoCard">
          <Image
            className="heroLogo"
            src="/moore-made-logo.png"
            alt="Moore Made logo"
            width={1800}
            height={900}
            priority
          />
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <div className="eyebrow">Simple custom ordering</div>
          <h2>From idea to finished product</h2>
          <div className="grid">
            <div className="card">
              <strong>01</strong>
              <h3>Tell us what you need</h3>
              <p className="muted">Share the product, colors, sizes, quantities, deadline, and anything else you already know.</p>
            </div>
            <div className="card">
              <strong>02</strong>
              <h3>Send your artwork</h3>
              <p className="muted">Upload your logo, photo, design, or reference files and tell us the size and placement you want.</p>
            </div>
            <div className="card">
              <strong>03</strong>
              <h3>We make it</h3>
              <p className="muted">We review the details, confirm the order with you, and move it into production.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
