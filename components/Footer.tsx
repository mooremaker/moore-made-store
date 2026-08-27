import Link from "next/link";

export function Footer() {
  return (
    <footer className="siteFooter">
      <div className="shell footerInner">
        <div className="footerBrand">
          <strong>Moore Made</strong>
          <span>Custom goods, made for you.</span>
          <Link href="/support/9e057323-8ba2-4ffe-83ad-d191e60846d8">Help Us Make Moore</Link>
        </div>
        <div className="footerLegal">
          <Link href="/terms/custom-orders">Custom Order Terms</Link>
          <span>© 2026 Moore Made LLC · mooremade.store</span>
        </div>
      </div>
    </footer>
  );
}
