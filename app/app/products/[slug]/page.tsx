import { notFound } from "next/navigation";
import { products } from "@/lib/catalog";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = products.find((item) => item.slug === slug);
  if (!product) notFound();

  return <div className="shell"><section className="pageHero"><span className="badge">{product.category}</span><h1>{product.name}</h1><p className="lead">{product.description}</p></section><div className="twoCol"><div className="heroCard"><div className="productImage" style={{aspectRatio:"4/3"}}>Product photography / preview</div><p className="muted">We’ll replace this placeholder with your real product photos or mockups.</p></div><div className="card"><h2>Customize</h2><form className="form"><div className="field"><label>Quantity</label><input type="number" min="1" defaultValue="1" /></div><div className="field"><label>Color / material / style</label><select defaultValue=""><option value="" disabled>Choose an option</option><option>Option A</option><option>Option B</option></select></div><div className="field"><label>Upload artwork</label><input type="file" accept="image/*,.pdf,.svg" /></div><div className="field"><label>Customization instructions</label><textarea placeholder="Example: Small logo on the front left chest and large logo centered on the back." /></div><button type="button" className="btn">Add to cart — coming next</button><p className="muted">{product.startingPrice ? `Base pricing starts around $${product.startingPrice}. Final pricing logic will come from the database.` : "This item will use the quote workflow."}</p></form></div></div></div>;
}
