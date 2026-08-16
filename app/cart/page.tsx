import Link from "next/link";
export default function CartPage(){return <div className="shell"><section className="pageHero"><h1>Your cart.</h1></section><div className="empty"><h2>Your cart is empty.</h2><p className="muted">Cart persistence and Stripe checkout are part of the next build phase.</p><Link className="btn" href="/shop">Go shopping</Link></div></div>}
