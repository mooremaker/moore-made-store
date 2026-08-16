import Link from "next/link";
import { ShowcaseCard } from "@/components/ShowcaseCard";
import { getApprovedShowcasePosts } from "@/lib/showcase-data";

export const dynamic = "force-dynamic";

export default async function MadeByYouPage() {
  const posts = await getApprovedShowcasePosts();
  return (
    <div className="shell madeByYouPage">
      <section className="pageHero madeByYouHero">
        <div className="eyebrow">Made by You</div>
        <h1>Real ideas.<br />Real orders.</h1>
        <p className="lead">A look at what Moore Made customers have created, gifted, worn, shared, and put to work.</p>
        <div className="actions"><Link className="btn" href="/made-by-you/submit">Share your order</Link><Link className="btn secondary" href="/custom-orders">Start your own</Link></div>
      </section>
      {posts.length ? <section className="showcaseGrid">{posts.map((post) => <ShowcaseCard key={post.id} post={post} />)}</section> : (
        <section className="empty showcaseEmpty"><h2>The first projects are coming.</h2><p className="muted">Have a Moore Made order already? Be the first to share it.</p><Link className="btn" href="/made-by-you/submit">Share your order</Link></section>
      )}
    </div>
  );
}
