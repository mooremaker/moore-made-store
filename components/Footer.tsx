import Link from "next/link";

export function Footer() {
  return (
    <footer className="siteFooter">
      <div className="shell footerInner">
        <div><strong>Moore Made</strong><br />Custom goods, made for you.</div>
        <div className="footerLegal"><Link href="/terms/custom-orders">Custom Order Terms</Link><span>© 2026 Moore Made LLC · mooremade.store</span></div>
      </div>
    </footer>
  );
}
