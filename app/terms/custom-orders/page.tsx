import Link from "next/link";
import {
  FINAL_SALE_POLICY_ACKNOWLEDGMENTS,
  FINAL_SALE_POLICY_TITLE,
  FINAL_SALE_POLICY_VERSION,
} from "@/lib/payment-policy";

export const metadata = {
  title: "Custom Order Terms | Moore Made",
  description: "Moore Made custom-order, proof approval, payment, and final-sale terms.",
};

export default function CustomOrderTermsPage() {
  return (
    <div className="shell policyPage">
      <section className="pageHero policyHero">
        <div className="eyebrow">Customer terms · {FINAL_SALE_POLICY_VERSION}</div>
        <h1>Custom Order Terms.</h1>
        <p className="lead">Please read these terms before paying for an approved custom order.</p>
      </section>

      <article className="card policyDocument">
        <section>
          <h2>{FINAL_SALE_POLICY_TITLE}</h2>
          <p>Moore Made creates custom, personalized, and hand-finished products. These terms apply to custom orders placed with Moore Made.</p>
        </section>

        <section>
          <h3>1. Proof and order approval</h3>
          <p>Before payment, customers are responsible for reviewing the final proof and order details provided for approval, including artwork, spelling, colors, sizing, quantities, placement, pricing, and other displayed specifications. Approval confirms that the displayed proof and order details are acceptable for production.</p>
        </section>

        <section>
          <h3>2. Final sales and non-refundable payments</h3>
          <p><strong>All custom-order sales are final. Deposits and payments are non-refundable. Custom products are not eligible for return or exchange.</strong> This policy is presented and must be acknowledged before Moore Made unlocks its website payment options.</p>
        </section>

        <section>
          <h3>3. Handmade and custom variations</h3>
          <p>Custom and hand-finished production may result in minor variations in placement, color, sizing, finish, texture, or appearance. Colors can also appear different between screens, digital proofs, materials, inks, transfers, and finished products. Minor variations that are inherent to custom or hand-finished production are not, by themselves, grounds for a refund.</p>
        </section>

        <section>
          <h3>4. Problems with a finished order</h3>
          <p>If you are unhappy with your finished order, please contact Moore Made as soon as reasonably possible and explain the issue. We will review the circumstances and do our best to rectify the issue. Depending on the situation, Moore Made may offer a correction, repair, remake, replacement, or another reasonable solution at its discretion. This problem-resolution process does not create a right to a cash refund.</p>
        </section>

        <section>
          <h3>5. Customer-supplied artwork</h3>
          <p>By supplying artwork, logos, photographs, trademarks, text, or other content, the customer represents that they have the right or permission needed for Moore Made to reproduce that material for the requested order. The customer authorizes Moore Made to use the submitted material only as reasonably necessary to prepare, produce, and fulfill the order.</p>
        </section>

        <section>
          <h3>6. Production timing</h3>
          <p>Quoted turnaround times and requested completion dates are estimates unless Moore Made expressly confirms otherwise in writing. Artwork changes, product availability, shipping delays, customer response time, and other circumstances can affect completion dates.</p>
        </section>

        <section>
          <h3>7. Shipping and pickup</h3>
          <p>Customers are responsible for providing accurate shipping or pickup information. Tracking information will be provided for shipped orders when available. Moore Made will communicate significant fulfillment issues when reasonably possible.</p>
        </section>

        <section>
          <h3>8. Required payment acknowledgments</h3>
          <div className="policyAcknowledgmentList">
            {FINAL_SALE_POLICY_ACKNOWLEDGMENTS.map((item) => <p key={item.key}>✓ {item.label}</p>)}
          </div>
        </section>

        <section>
          <h3>9. Rights that cannot be waived</h3>
          <p>Nothing in these terms is intended to limit any right, remedy, or responsibility that cannot legally be waived or excluded.</p>
        </section>

        <footer className="policyDocumentFooter">
          <p><strong>Policy version:</strong> {FINAL_SALE_POLICY_VERSION}</p>
          <p>Questions about an order? Sign in to your Moore Made account and send the admin team a message.</p>
          <Link className="btn secondary" href="/">Back to Moore Made</Link>
        </footer>
      </article>
    </div>
  );
}
