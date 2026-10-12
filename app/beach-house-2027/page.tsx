import type { Metadata } from "next";
import styles from "./page.module.css";
import { PaymentSchedule } from "./PaymentTools";
import SavedTracker from "./SavedTracker";

export const metadata: Metadata = {
  title: "Beach House 2027 | Payment Plan",
  description: "Our Ocean City beach week: trip details, room shares, and monthly payments.",
  robots: { index: false, follow: false },
};

const januaryPool = "https://cash.app/f/POOL?id=0c9zfc2r";
const aprilPool = "https://cash.app/f/POOL?id=nyi1n898";


export default function BeachHousePage() {
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <span className={styles.eyebrow}>Ocean City, New Jersey<br /><span className={styles.tripDate}>June 12–19, 2027</span></span>
        <h1>More beach.<br />Less last-minute scrambling.</h1>
        <p>Let’s get our house payments covered a little at a time, so we aren’t scrambling for payments at the last minute.</p>
        <div className={styles.facts}>
          <div><strong>4 rooms</strong><span>Equal shares per room</span></div>
          <div><strong>$962</strong><span>Planned per room</span></div>
          <div><strong>5 payments</strong><span>November through March</span></div>
        </div>
      </header>

      <aside className={styles.notice}><strong>The $500 deposit has been paid.</strong></aside>

      <section className={styles.section} aria-labelledby="schedule-heading">
        <span className={styles.eyebrow}>Smaller payments, ahead of time</span>
        <h2 id="schedule-heading">Choose your payment schedule</h2>
        <p>Amounts below are due by the listed date. You can pay early or cover your full share at once—just divide it between the two pools.</p>
        <PaymentSchedule savedEnabled={process.env.BEACH_HOUSE_TRACKER_ENABLED === "true"} />
        <p className={styles.small}>Smaller payments are welcome. For example, $50 a week is fine—as long as your required total is covered by each collection date.</p>
        <p className={styles.small}>*Two people splitting equally. A room with one occupant owes the full room share.</p>
        <p className={styles.small}>Rounded payments collect $3 above the remaining house balance and will go towards payment processing fees from Fox Real Estate.</p>
      </section>

      <section className={styles.section} aria-labelledby="pay-heading">
        <span className={styles.eyebrow}>Two goals, one plan</span>
        <h2 id="pay-heading" className={styles.poolHeading}>Choose the right payment pool</h2>
        <div className={styles.pools}>
          <article className={styles.pool}>
            <span>01 · January house payment</span><h3>$2,000</h3>
            <p><strong>$500 per room</strong> · $250 each when two people share.</p>
            <p>Collect by <strong>December 15, 2026</strong><br />Lease payment due January 15, 2027.</p>
            <a className={styles.button} href={januaryPool}>Pay toward January ↗</a>
          </article>
          <article className={styles.pool}>
            <span>02 · April house payment</span><h3>$1,845</h3>
            <p><strong>$462 per room</strong> · $231 when shared.</p>
            <p>Collect by <strong>March 15, 2027</strong><br />Lease payment due April 12, 2027.</p>
            <a className={styles.button} href={aprilPool}>Pay toward April ↗</a>
          </article>
        </div>
        <p className={styles.small}>Both buttons open Cash App. Enter the amount you’re contributing and check the pool name and organizer before paying. Payments and contribution history are handled in Cash App.</p>
      </section>

      <SavedTracker enabled={process.env.BEACH_HOUSE_TRACKER_ENABLED === "true"} remindersEnabled={process.env.BEACH_HOUSE_REMINDERS_ENABLED === "true"} />
      <div className={styles.footerNotes}>
        <p>Coordinate with your roommate, set payment reminders, and use your recognizable name in Cash App.</p>
        <p>Contact Sal early if you can’t make a payment or your plans change.</p>
        <p>Cash App holds the money. Saved balances show payments confirmed by Sal; they do not sync automatically with Cash App.</p>
      </div>
    </div>
  );
}
