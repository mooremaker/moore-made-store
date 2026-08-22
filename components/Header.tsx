"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cachedCustomRequestCartCount, CUSTOM_REQUEST_CART_EVENT, getCustomRequestCart } from "@/lib/custom-request-cart";

const links = [
  { href: "/shop", label: "Shop" },
  { href: "/cart", label: "Cart" },
  { href: "/custom-orders", label: "Order Form" },
  { href: "/made-by-you", label: "Made by You" },
  { href: "/account", label: "Account" },
];

function navIsActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function QuickNavIcon({ name }: { name: "shop" | "cart" | "account" }) {
  if (name === "shop") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16l-1-5H5l-1 5Z"/><path d="M6 10v9h12v-9M9 19v-5h6v5"/></svg>;
  if (name === "cart") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2 10h10l2-7H6"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 21c.6-4 3-6 7-6s6.4 2 7 6"/></svg>;
}

export function Header() {
  const [open, setOpen] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const pathname = usePathname();
  const leavingAdmin = pathname?.startsWith("/admin") ?? false;

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    setCartCount(cachedCustomRequestCartCount());
    getCustomRequestCart().then((items) => setCartCount(items.length)).catch(() => {});
    const onCartChange = (event: Event) => setCartCount(Number((event as CustomEvent<{ count?: number }>).detail?.count || 0));
    window.addEventListener(CUSTOM_REQUEST_CART_EVENT, onCartChange);
    return () => window.removeEventListener(CUSTOM_REQUEST_CART_EVENT, onCartChange);
  }, []);

  const brand = (
    <img
      className="brandLogo"
      src="/moore-made-header-logo.png"
      alt="Moore Made"
      width={190}
      height={63}
    />
  );

  return (
    <>
    <header className="siteHeader">
      <div className="shell headerInner">
        {leavingAdmin ? (
          <a className="brand" href="/" aria-label="Moore Made home">
            {brand}
          </a>
        ) : (
          <Link className="brand" href="/" aria-label="Moore Made home">
            {brand}
          </Link>
        )}

        <button
          className="menuButton"
          type="button"
          aria-expanded={open}
          aria-controls="main-navigation"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          <span />
          <span />
          <span />
        </button>

        <nav
          id="main-navigation"
          className={`nav ${open ? "navOpen" : ""}`}
          aria-label="Main navigation"
        >
          {links.map((link) =>
            leavingAdmin ? (
              <a
                key={link.href}
                href={link.href}
                className={navIsActive(pathname, link.href) ? "navActive" : undefined}
              >
                {link.label}{link.href === "/cart" && cartCount > 0 ? ` (${cartCount})` : ""}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className={navIsActive(pathname, link.href) ? "navActive" : undefined}
              >
                {link.label}{link.href === "/cart" && cartCount > 0 ? ` (${cartCount})` : ""}
              </Link>
            )
          )}
        </nav>
      </div>
    </header>
    {!leavingAdmin ? <nav className="mobileQuickNav" aria-label="Quick navigation">
      <Link href="/shop" className={navIsActive(pathname, "/shop") ? "active" : ""} aria-current={navIsActive(pathname, "/shop") ? "page" : undefined}><QuickNavIcon name="shop" /><span>Shop</span></Link>
      <Link href="/cart" className={navIsActive(pathname, "/cart") ? "active" : ""} aria-current={navIsActive(pathname, "/cart") ? "page" : undefined}><span className="mobileQuickNavIcon"><QuickNavIcon name="cart" />{cartCount > 0 ? <b aria-label={`${cartCount} items in cart`}>{cartCount > 99 ? "99+" : cartCount}</b> : null}</span><span>Cart</span></Link>
      <Link href="/account" className={navIsActive(pathname, "/account") ? "active" : ""} aria-current={navIsActive(pathname, "/account") ? "page" : undefined}><QuickNavIcon name="account" /><span>Account</span></Link>
    </nav> : null}
    </>
  );
}
