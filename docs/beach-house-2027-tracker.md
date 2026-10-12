# Saved beach-house contributions

This adds a private account tracker to the existing beach page. It does not move funds, charge a card, read a Cash App account, or treat a submitted payment as verified.

## Activate after the migration

1. Run `supabase/beach_house_2027_tracker.sql` in the existing Moore Made Supabase SQL editor. The earlier reminder migration remains required and is unchanged.
2. Set the production Vercel environment variable `BEACH_HOUSE_TRACKER_ENABLED=true` and redeploy. Until then the existing public payment plan and email reminders continue without querying these new tables.
3. Visit `/beach-house-2027/sign-in` and sign in with the existing Moore Made email-code/magic-link flow. The same account works on multiple devices. Supabase's existing redirect allowlist should already include the site's `/auth/callback` flow.
4. Each participant saves their name, Cash App display name or $Cashtag, requested room, and half/full room share. Sal confirms room assignments in `/beach-house-2027/manage` before contributions can be recorded.
5. The organizer page uses existing Moore Made administrator accounts and requires their authenticator verification. Customers never receive other participants' balances or histories.

## Payment workflow

- A contributor pays any smaller amount into the relevant Cash App pool, then records amount, date, pool, and optional transaction reference on the page.
- A recorded contribution starts pending. The organizer checks the real Cash App pool and confirms it. Only confirmed contributions reduce remaining balances.
- The organizer can also add a confirmed payment directly after observing it in Cash App, if the contributor did not record it.
- References are unique within each pool while an entry is pending/confirmed. A client-generated request ID prevents a retried submission from creating a second entry.
- Each pool is tracked separately. January money never silently pays April obligations. Confirmed amounts apply to that pool's earliest collection date first.
- Example: three confirmed $50 January contributions cover the first $125 collection and $25 of December. Five $50 contributions cover the full $250 January share for someone splitting a room.
- Half-room total is $481; full-room total is $962. Pending/rejected entries do not reduce balances. Excess received in one pool does not reduce the other pool's balance.
- Signed-in checklist ticks are saved separately from confirmed financial balances. Guests retain the existing browser-local checklist. Ticking a box is never payment confirmation.
- Once a confirmed participant's verified payments cover a collection, scheduled reminder emails for that collection are skipped. Inactive participants are skipped. Pending payment reports never suppress reminders.

## Security and verification

Every personal API derives the owner from the verified auth session. Client-supplied owner IDs and payment statuses are ignored. Organizer reads/writes use the existing admin + MFA gate. Both tables have RLS enabled and are only writable through service-role server code; personal reads are explicitly scoped to the authenticated user. Checklist changes are atomic, room approvals use an advisory transaction lock, and payment reviews require the record's expected previous status to avoid confirming a stale/withdrawn entry.

Checks performed: TypeScript; exact-cent parsing; $50 installments and carry-forward; half/full room goals; pool separation; exclusion of pending/rejected records; signed-out and staff-MFA denial; ignored spoofed owner/status fields; owner-scoped record/checklist queries. These tests use isolated mocks and do not create real people, move money, or send emails. Actual database persistence and email sign-in require the migration and a real signed-in test after activation.

Cash App's documented APIs cover Cash App Pay merchant integrations. This tracker uses manual confirmation of personal Pool contributions; it does not claim an automatic personal Pool webhook integration.
