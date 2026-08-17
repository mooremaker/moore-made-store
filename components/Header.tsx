"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/shop", label: "Shop" },
  { href: "/custom-orders", label: "Custom Orders" },
  { href: "/made-by-you", label: "Made by You" },
  { href: "/account", label: "Account" },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="siteHeader">
      <div className="shell headerInner">
        <Link className="brand" href="/" aria-label="Moore Made home">
          <Image
            className="brandLogo"
            src="/moore-made-header-logo.png"
            alt="Moore Made"
            width={190}
            height={63}
            priority
          />
        </Link>

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
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname === link.href ? "navActive" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
