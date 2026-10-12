# Beach house payment page and email reminders

The page lives at `/beach-house-2027`. It uses the supplied January and April Cash App pool links. Checkboxes only mark a payment on the current browser/device; they do not verify a Cash App payment or stop email reminders.

## Install and test locally

Copy the included `app`, `lib`, and `supabase` files into the existing Moore Made checkout. Add the included `vercel.json` cron entry to the project's configuration; if a local `vercel.json` already exists, merge the `crons` entry rather than replacing it.

Run `npm run dev` and open `http://localhost:3000/beach-house-2027`. No new package dependency is needed. The existing shop navigation is unchanged. The page is marked `noindex,nofollow` but is accessible to anyone with the link.

## Enable reminders

1. Run `supabase/beach_house_2027_reminders.sql` in the existing Moore Made Supabase SQL editor. This creates two private tables; existing tables are unaffected.
2. Use the existing `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, and `MOORE_MADE_FROM_EMAIL` configuration. The From address must be verified in Resend. `MOORE_MADE_ADMIN_EMAIL` is the optional reply address.
3. Add a long, random `CRON_SECRET` in the Vercel production environment. Add `BEACH_HOUSE_REMINDERS_ENABLED=true` after the database and sender are ready. Leave the flag absent/false in preview environments.
4. Confirm `MOORE_MADE_PUBLIC_URL=https://mooremade.store` (or leave it unset to use that default).
5. Deploy through the project's normal process. The cron runs daily at 14:00 UTC, which is morning Eastern time. It only sends on the relevant dates, using America/New_York for date calculations. No exact delivery minute is promised.
6. Test sign-up with your own email. Open the confirmation link, press Confirm, and check the unsubscribe flow. No reminders are sent to unconfirmed addresses. Once confirmed, subscribers receive only upcoming reminders; past reminders are not backfilled.

Emails are sent 14 days before, 7 days before, and on each collection date: November 15, December 15, January 15, February 15, and March 15. These are the group collection dates, not the landlord's January 15 / April 12 deadlines. Each email links to the appropriate pool and explains that someone who has already paid can ignore the reminder.

Sign-up returns an honest unavailable message until configuration is enabled. The email field in the conversation preview is a demonstration; it does not subscribe anyone.

The delivery ledger and Resend idempotency key avoid duplicate sends during repeated/concurrent cron calls. The cron can be retried on the same day after a temporary failure. Subscribers can unsubscribe using a signed random-token link and a confirmation button; opening an email link alone never changes the subscription.

## Validation performed

- TypeScript check.
- All 15 reminder offsets plus off-days and Eastern-time boundaries around DST.
- Room and person payment totals.
- Local page rendering, schedule checkbox/link counts, noindex metadata.
- API handlers exercised directly for invalid email/consent, cross-origin signup, disabled email configuration, unauthenticated cron calls, and invalid confirmation tokens. Database and provider calls were blocked in these tests.

Actual Supabase writes and email delivery require the migration and production configuration. No real email was sent during these checks.

The rounded schedule totals $962 per room / $481 per person, or $3,848 across four rooms. This is $3 above the remaining $3,845 lease balance; the actual April landlord payment remains $1,845.
