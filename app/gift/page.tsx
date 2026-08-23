import type { Metadata } from "next";
import { SupportGiftForm } from "@/components/support/SupportGiftForm";

export const metadata: Metadata = { title: "Gift Moore Made’s Growth", description: "Make a voluntary, non-repayable gift to Moore Made LLC.", robots: { index: false, follow: false } };

export default function GiftPage() {
  return <main className="giftPage"><section className="giftPageShell">
    <header className="giftHeader"><div className="giftBrand"><strong>MOORE<span>/</span>MADE</strong><small>Your Idea. Moore Made.</small></div><span className="giftBadge">Voluntary gift</span><h1>Gift Moore Made’s Growth</h1><p>Help Sal and Matt strengthen production, build a healthier cash cushion, and invest carefully in the equipment Moore Made needs next.</p></header>
    <section className="giftTrust"><article><strong>No investment terms</strong><span>No ownership, repayment, interest, or profit sharing.</span></article><article><strong>No purchase required</strong><span>No products, services, or future discounts are exchanged.</span></article><article><strong>Secure payment</strong><span>Your unique checkout link is sent through Moore Made and paid through Stripe.</span></article></section>
    <SupportGiftForm />
    <aside className="giftLegal"><strong>Please understand before continuing</strong><p>Moore Made LLC is a for-profit company. This is a voluntary, non-repayable gift—not a charitable contribution, loan, investment, preorder, or purchase. It is not represented as tax-deductible. Please consult your own tax adviser if you have questions.</p></aside>
  </section></main>;
}

