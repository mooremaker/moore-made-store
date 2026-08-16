import Link from "next/link";
import type { PublicShowcasePost } from "@/lib/showcase-data";

export function ShowcaseCard({ post }: { post: PublicShowcasePost }) {
  const displayName = post.business_name || post.customer_name;
  return (
    <article className="showcaseCard card">
      <div className="showcasePhoto">
        {post.photoUrls[0] ? <img src={post.photoUrls[0]} alt={`${post.product} customer project`} /> : <div className="showcasePhotoFallback">Made by You</div>}
      </div>
      <div className="showcaseBody">
        <div className="showcaseMeta"><span>{post.product}</span><span className="stars" aria-label={`${post.rating} out of 5 stars`}>{"★".repeat(post.rating)}{"☆".repeat(5 - post.rating)}</span></div>
        <h3>{displayName}</h3>
        <p className="showcaseReview">“{post.review}”</p>
        <Link className="textLink" href="/custom-orders">Want something like this? →</Link>
      </div>
    </article>
  );
}
