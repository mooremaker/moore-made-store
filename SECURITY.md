# Moore Made Security Model

## Customer data

Customer orders are linked to a Supabase Auth user by `customer_user_id`. RLS policies only grant an authenticated customer `SELECT` access when the row belongs to `auth.uid()`.

The same ownership chain protects quotes, proof items, proof assets, and revision history.

## Roles

Permissions are kept in `public.user_roles`, separate from editable customer profile fields. Authenticated users can read their own role but are not granted permission to insert or update roles.

Admin promotion is an explicit database-owner action performed from the Supabase dashboard/SQL editor.

## Admin access

Admin pages and mutation APIs require:
1. a verified Supabase Auth user;
2. an `admin` role; and
3. a session at Authenticator Assurance Level 2 (TOTP MFA).

Only after those checks do server routes use the Supabase secret/service client.

## Secret keys

`SUPABASE_SECRET_KEY` and Resend credentials remain server-side only. They must never be prefixed with `NEXT_PUBLIC_`, embedded in React components, or committed to Git.

## Storage

Customer artwork, quote proofs, and showcase uploads remain in private Supabase Storage buckets. Phase 3 adds authenticated read policies based on ownership, while the customer dashboard uses short-lived signed URLs for file access.

## Public proof links

Proof + quote emails still use a high-entropy private token so customers can approve without creating an account or signing in. Treat the emailed approval URL like a private document link: whoever possesses the link can view that proof. Quote pages are marked `noindex` and approval expires based on the quote's validity date.

## Payment data

When payments are added, card numbers/CVV should remain entirely inside Stripe-hosted Checkout. Moore Made should store only Stripe identifiers, amount/status, and business records—not raw payment-card data.

## Before production launch

Run Supabase Security Advisor and verify RLS is enabled on every table containing customer/business data. Also enable custom SMTP, configure Auth rate limits/attack protection as appropriate, keep admin MFA mandatory, and test privacy using two separate customer accounts.
