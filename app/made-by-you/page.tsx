import Link from "next/link";
import { ShowcaseCustomerGroup } from "@/components/ShowcaseCustomerGroup";
import { getApprovedShowcasePosts, type PublicShowcasePost } from "@/lib/showcase-data";

export const dynamic = "force-dynamic";

function groupByCustomer(posts: PublicShowcasePost[]) {
  const grouped = new Map<string, PublicShowcasePost[]>();
  for (const post of posts) {
    const current = grouped.get(post.customerGroupKey) ?? [];
    current.push(post);
    grouped.set(post.customerGroupKey, current);
  }
  return Array.from(grouped.values());
}

export default async function MadeByYouPage() {
  const posts = await getApprovedShowcasePosts();
  const customerGroups = groupByCustomer(posts);

  return (
    <div className="shell madeByYouPage">
      <section className="pageHero madeByYouHero">
        <div className="eyebrow">Made by You</div>
        <h1>Real ideas.<br />Real orders.</h1>
        <p className="lead">A look at what Moore Made customers have created, gifted, worn, shared, and put to work.</p>
        <div className="actions"><Link className="btn" href="/made-by-you/submit">Share your order</Link><Link className="btn secondary" href="/shop">Visit the shop</Link></div>
      </section>
      {customerGroups.length ? (
        <section className="showcaseGrid">
          {customerGroups.map((group) => <ShowcaseCustomerGroup key={group[0]?.customerGroupKey} posts={group} />)}
        </section>
      ) : (
        <section className="empty showcaseEmpty"><h2>The first projects are coming.</h2><p className="muted">Have a Moore Made order already? Be the first to share it.</p><Link className="btn" href="/made-by-you/submit">Share your order</Link></section>
      )}
    </div>
  );
}
