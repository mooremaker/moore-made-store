import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SupportInterestForm } from "@/components/support/SupportInterestForm";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { SupportPageSettings } from "@/lib/support-types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Support Moore Made",
  description: "A private overview of Moore Made's plans and voluntary support goals.",
  robots: { index: false, follow: false, nocache: true },
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.max(0, cents) / 100);
}

const mainRoadmapGroups = [
  {
    label: "Needed now",
    goals: [
      { name: "Repair DTF Printer", amountCents: 220000, description: "Bring in-house DTF production back online for faster turnaround and more control." },
      { name: "Supplies & Production Setup", amountCents: 840000, description: "Blanks, transfers, a second heat press, workstations, storage, shipping supplies, and branded packaging needed to fulfill orders reliably." },
    ],
  },
  {
    label: "Next to unlock",
    goals: [
      { name: "15-Needle Embroidery Machine", amountCents: 600000, description: "Add multi-color embroidery for hats, polos, apparel, and business orders." },
    ],
  },
  {
    label: "Long-term home for Moore Made",
    goals: [
      { name: "Dedicated Workshop or Future Storefront Fund", amountCents: 3500000, description: "Build toward whichever dedicated Moore Made space best fits the business—with room for equipment, inventory, storage, customer service, and future growth." },
    ],
  },
];

const futureRoadmapGoals = [
  { name: "Event & Pop-Up Setup", amountCents: 300000 },
  { name: "Product Photography & Mockup Studio", amountCents: 100000 },
];

export default async function SupportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = getSupabaseAdmin();
  const { data: settingsData, error } = await supabase.from("support_page_settings").select("id,enabled,access_token,expires_at,phone,contact_email,funding_goal_cents,headline,introduction,updated_at").eq("access_token", token).maybeSingle();
  const settings = settingsData as SupportPageSettings | null;
  if (error || !settings?.enabled || !settings.phone || !settings.contact_email) notFound();
  if (settings.expires_at && new Date(settings.expires_at) <= new Date()) return <div className="supportPage"><section className="supportExpiredPage"><div className="supportHeroBrand"><strong>MOORE<span>/</span>MADE</strong><small>Your Idea. Moore Made.</small></div><span>Private link expired</span><h1>This supporter link needs to be refreshed.</h1><p>Nothing is wrong with your device. Please contact Moore Made and we’ll send you a current private link.</p><div><a className="supportPrimaryButton" href={`tel:${settings.phone}`}>Call MooreMade with questions</a><a className="supportSecondaryButton" href={`mailto:${settings.contact_email}`}>Email Moore Made</a></div></section></div>;

  const [{ data: gifts }, { data: businessSettings }] = await Promise.all([
    supabase.from("business_funding_entries").select("amount_cents").eq("entry_type", "gift_received").is("voided_at", null),
    supabase.from("business_settings").select("weekly_sales_goal_cents,weekly_profit_goal_cents,weekly_owner_goal_cents,weekly_reserve_goal_cents").eq("id", "default").maybeSingle(),
  ]);
  const received = (gifts || []).reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
  const fundingGoal = Number(settings.funding_goal_cents || 0);
  const progress = fundingGoal > 0 ? Math.round(received / fundingGoal * 100) : 0;
  const weeklySales = Number(businessSettings?.weekly_sales_goal_cents ?? 750000);
  const weeklyProfit = Number(businessSettings?.weekly_profit_goal_cents ?? 300000);
  const weeklyOwners = Number(businessSettings?.weekly_owner_goal_cents ?? 270000);
  const weeklyReserve = Number(businessSettings?.weekly_reserve_goal_cents ?? 30000);
  const legacyHeadline = "Help Moore Made build the equipment and stability needed to grow.";
  const displayHeadline = settings.headline === legacyHeadline ? "Help Moore Made build what comes next." : settings.headline;
  const goalSummary = "DTF printer repair, dependable production supplies, embroidery, and a dedicated workshop or storefront";
  const legacyIntroduction = settings.introduction.startsWith("Moore Made is building a dependable two-owner custom-goods business.");
  const introductionParagraphs = legacyIntroduction ? [
    "Moore Made is a two-owner custom-goods business with a clear plan: protect quality, strengthen production, and invest carefully in the equipment that helps us serve more customers.",
    `Our full-capacity targets are ${money(weeklySales)} in weekly sales and ${money(weeklyProfit)} in weekly business profit. We are working toward them through stronger reserves, dependable systems, and ${goalSummary}. These are measured planning goals—not promised results.`,
  ] : settings.introduction.split(/\n\s*\n/).filter(Boolean);
  const planningItemRevenue = 3000;
  const planningItemsPerOrder = 10;
  const capacityStages = [
    { name: "Foundation", percent: 35, note: "Build repeat customers and a dependable local rhythm." },
    { name: "Growth", percent: 65, note: "Add organizations, events, referrals, and proven ads." },
    { name: "Full capacity", percent: 100, note: "Two-owner production operating near the current planning goal." },
  ].map((stage) => {
    const sales = Math.round(weeklySales * stage.percent / 100);
    const profit = Math.round(weeklyProfit * stage.percent / 100);
    const pieces = Math.ceil(sales / planningItemRevenue);
    return { ...stage, sales, profit, pieces, orders: Math.ceil(pieces / planningItemsPerOrder), piecesPerDay: Math.ceil(pieces / 5) };
  });

  return <div className="supportPage">
    <section className="supportHero">
      <div className="supportHeroBrand"><strong>MOORE<span>/</span>MADE</strong><small>Your Idea. Moore Made.</small></div>
      <div className="supportPrivateBadge">Private supporter overview</div>
      <h1>{displayHeadline}</h1>
      <div className="supportHeroIntro">{introductionParagraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
      <div className="supportHeroStats"><span><strong>2 owners</strong><small>Building together</small></span><span><strong>Clear safeguards</strong><small>Costs and margins tracked</small></span><span><strong>Scalable production</strong><small>Equipment unlocks capacity</small></span></div>
      <div className="supportHeroUtility supportHeroSingleAction"><a href="#support-form">Interested in supporting Moore Made? Leave your contact details</a></div>
      <p className="supportHeroNote">No payment or commitment is made on this page.</p>
    </section>
    <nav className="supportJumpNav" aria-label="Support page sections"><a href="#business">The business</a><a href="#growth-runway">Growth runway</a><a href="#production-plan">Production + ads</a><a href="#support-needs">What support unlocks</a></nav>

    <section className="supportStory supportSection" id="business">
      <div className="supportSectionNumber">01</div>
      <div className="supportSectionCopy"><div className="supportEyebrow">The business</div><h2>A careful custom-order company built to last.</h2><p>Moore Made creates custom apparel, bags, drinkware, paper goods, gifts, and business materials. Customers share their idea, receive a mockup and safeguarded quote, approve the work, pay securely, and receive production and fulfillment updates.</p><p>Sal and Matt are building the company around clear communication, repeatable production, honest pricing, organized financial records, and finished work customers are excited to share.</p></div>
      <div className="supportFlow" aria-label="Moore Made customer process"><span>Idea</span><b>→</b><span>Proof + quote</span><b>→</b><span>Approval</span><b>→</b><span>Production</span><b>→</b><span>Delivery</span></div>
    </section>

    <section className="supportSection">
      <div className="supportSectionNumber">02</div>
      <div className="supportSectionCopy"><div className="supportEyebrow">The plan</div><h2>Grow production without sacrificing quality.</h2><p>The immediate goal is dependable two-owner production: purchase supplies comfortably, maintain working cash, reduce outsourcing where it makes sense, and add equipment only when the numbers support it.</p></div>
      <div className="supportPlanGrid">
        <article><span>Start steady</span><h3>Build the cushion</h3><p>Keep blanks, transfers, packaging, shipping, software, and unexpected reprints from straining ordinary cash flow.</p></article>
        <article><span>Grow carefully</span><h3>Improve capacity</h3><p>Standardize production, photograph real blanks, attend events, market consistently, and complete more orders together.</p></article>
        <article><span>Produce more</span><h3>Own key equipment</h3><p>Work toward printing and embroidery equipment that can improve turnaround, control, product variety, and long-term margins.</p></article>
      </div>
    </section>

    <section className="supportSection supportGoalsSection" id="growth-runway">
      <div className="supportSectionNumber">03</div>
      <div className="supportSectionCopy"><div className="supportEyebrow">Full-capacity planning goals</div><h2>What success could support.</h2><p>These are internal planning goals—not promises or guaranteed results. They show what Moore Made is working toward when both owners can maintain a strong, sustainable production schedule.</p></div>
      <div className="supportNumbers">
        <article><span>Weekly sales goal</span><strong>{money(weeklySales)}</strong><small>Full-capacity weekly target</small></article>
        <article><span>Weekly business-profit goal</span><strong>{money(weeklyProfit)}</strong><small>Before owner tax reserves</small></article>
        <article><span>Combined owner goal</span><strong>{money(weeklyOwners)}</strong><small>Before personal tax reserves</small></article>
        <article><span>Weekly business reserve goal</span><strong>{money(weeklyReserve)}</strong><small>For stability and reinvestment</small></article>
      </div>
      <div className="supportAnnualSummary">
        <div className="supportAnnualSummaryHead"><div><span>Annual planning view</span><strong>What 52 consistent weeks could support</strong></div><small>Planning equivalent—not a forecast or guaranteed result</small></div>
        <div className="supportAnnualNumbers"><article><span>Annual sales goal</span><strong>{money(weeklySales * 52)}</strong></article><article><span>Annual business-profit goal</span><strong>{money(weeklyProfit * 52)}</strong></article><article><span>Combined annual owner goal</span><strong>{money(weeklyOwners * 52)}</strong><small>Before personal tax reserves</small></article><article><span>Annual business reserve goal</span><strong>{money(weeklyReserve * 52)}</strong><small>For stability and reinvestment</small></article></div>
      </div>
      <div className="supportProjectionIntro"><strong>A realistic runway—not one giant leap.</strong><p>The goal is to grow through measurable stages. Each milestone below is calculated from Moore Made’s editable weekly goals and shows the scale the business is working toward.</p></div>
      <div className="supportProjectionGrid">
        <article><div className="supportProjectionHead"><span>Estimated weekly sales</span><strong>{money(weeklySales)} goal</strong></div>{capacityStages.map((stage) => <div className="supportProjectionRow" key={`sales-${stage.name}`}><div><b>{stage.name}</b><span>{money(stage.sales)}</span></div><div className="supportProjectionTrack"><span style={{ width: `${stage.percent}%` }} /></div></div>)}</article>
        <article><div className="supportProjectionHead"><span>Estimated weekly business profit</span><strong>{money(weeklyProfit)} goal</strong></div>{capacityStages.map((stage) => <div className="supportProjectionRow isProfit" key={`profit-${stage.name}`}><div><b>{stage.name}</b><span>{money(stage.profit)}</span></div><div className="supportProjectionTrack"><span style={{ width: `${stage.percent}%` }} /></div></div>)}</article>
      </div>
      <div className="supportCapacityNote"><strong>How production capacity is evaluated</strong><p>Moore Made tracks orders, pieces, labor hours, material costs, equipment needs, payment fees, overhead, estimated profit, and true margin. Larger orders are priced to reward customers for volume while still covering the additional labor required.</p></div>
    </section>

    <section className="supportSection" id="production-plan">
      <div className="supportSectionNumber">04</div>
      <div className="supportSectionCopy"><div className="supportEyebrow">Production + customer growth</div><h2>What reaching the goal could look like.</h2><p>This example uses an average of {money(planningItemRevenue)} in customer revenue per finished item and about {planningItemsPerOrder} pieces per order. The actual mix will vary across apparel, mugs, bags, business orders, and larger group orders.</p></div>
      <div className="supportCapacityTable">{capacityStages.map((stage) => <article key={stage.name}><div className="supportCapacityStage"><span>{stage.percent}% of weekly goal</span><h3>{stage.name}</h3><p>{stage.note}</p></div><div><strong>{stage.pieces}</strong><span>pieces / week</span></div><div><strong>{stage.orders}</strong><span>orders / week</span></div><div><strong>{stage.piecesPerDay}</strong><span>pieces / production day</span></div></article>)}</div>
      <div className="supportAssumptionNote">Planning example only. A higher average order value or larger group orders can reach the same sales goal with fewer individual orders; smaller one-off products may require more pieces.</div>
      <div className="supportAdPlan">
        <div className="supportAdPlanHead"><span>How Moore Made plans to bring in customers</span><h3>Earn attention, test carefully,<br />then scale what pays for itself.</h3></div>
        <div className="supportAdSteps"><article><b>1</b><div><strong>Build the local base</strong><p>Google Business Profile, customer photos, reviews, referrals, local organizations, festivals, and repeat-business follow-up.</p></div></article><article><b>2</b><div><strong>Run small paid tests</strong><p>Start around $100–$150 per week across focused Meta/Instagram and local search campaigns—not broad untargeted spending.</p></div></article><article><b>3</b><div><strong>Measure profitable orders</strong><p>Track inquiries, quotes, approvals, order value, ad cost, and profit. Pause campaigns that do not create profitable customers.</p></div></article><article><b>4</b><div><strong>Scale proven winners</strong><p>Increase only after results are repeatable, generally keeping advertising near 5–7% of sales and combining it with referrals and repeat clients.</p></div></article></div>
        <p className="supportAdFinePrint">Advertising is a customer-acquisition plan, not a guarantee. The goal is to create a diversified pipeline so Moore Made is never depending on one ad, one platform, or one customer.</p>
      </div>
    </section>

    <section className="supportSection" id="support-needs">
      <div className="supportSectionNumber">05</div>
      <div className="supportSectionCopy"><div className="supportEyebrow">What support unlocks</div><h2>Give Moore Made more room to operate.</h2><p>Voluntary gifts would remain with Moore Made LLC and may help fund the needs below. Priorities can change as equipment quotes, order volume, and production experience change.</p></div>
      <div className="supportRoadmapGroups">{mainRoadmapGroups.map((group) => <section className="supportRoadmapGroup" key={group.label}><div className="supportRoadmapGroupLabel">{group.label}</div><div className="supportRoadmapMainGrid">{group.goals.map((goal) => <article key={goal.name}><div><strong>{goal.name}</strong><b>{money(goal.amountCents)}</b></div><p>{goal.description}</p></article>)}</div></section>)}</div>
      <details className="supportFullRoadmap"><summary><span>See the full Moore Made growth roadmap</span><small>2 additional future goals</small></summary><div className="supportFutureRoadmapGrid">{futureRoadmapGoals.map((goal) => <article key={goal.name}><span>{goal.name}</span><strong>{money(goal.amountCents)}</strong></article>)}</div><p>The example roadmap shown here totals {money(5560000)}. Moore Made may set a different public support target as active goals, quotes, funding already received, and business priorities change. The workshop/storefront amount is one flexible facility fund—not two separate spaces.</p></details>
      {fundingGoal > 0 ? <div className="supportGoalProgress"><div><span>Moore Made support received</span><strong>{money(received)} of {money(fundingGoal)}</strong></div><div className="supportProgressTrack"><span style={{ width: `${Math.min(100, progress)}%` }} /></div><p>{progress >= 100 ? `Goal reached · ${progress}% funded` : `${progress}% funded · ${money(Math.max(0, fundingGoal - received))} remaining`}</p></div> : null}
      <div className="supportGiftNotice"><strong>A voluntary gift—not an investment, loan, preorder, or charitable donation.</strong><p>Support is a voluntary gift to Moore Made LLC. It provides no ownership, repayment, interest, profit sharing, products, services, future discounts, or charitable tax deduction. Gifts may be used where the business needs them most as priorities, quotes, order volume, and production needs change. Business results are never guaranteed.</p></div>
      <div className="supportGiftCheckoutCta"><div><strong>Ready to make a voluntary gift?</strong><span>Enter your contact details once, then receive a unique secure Stripe link by email.</span></div><a href="/gift">Gift Moore Made’s Growth</a></div>
    </section>

    <SupportInterestForm token={token} phone={settings.phone} />
    <footer className="supportFooter"><strong>Moore Made LLC</strong><span>Your Idea. Moore Made.</span><a href={`mailto:${settings.contact_email}`}>{settings.contact_email}</a><a href={`tel:${settings.phone}`}>{settings.phone}</a></footer>
  </div>;
}
