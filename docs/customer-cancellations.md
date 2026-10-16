# Customer cancellations

Run `supabase/moore_made_phase6_66_customer_cancellations.sql` before deploying these controls. It requires the existing order, payment, worksheet, mockup history and messaging tables. It is safe to run repeatedly.

Signed-in customers open an order in Account and choose **Cancel request** or **Request cancellation**, enter a reason, and confirm. The server checks ownership and the current saved state rather than trusting the button label.

- New, reviewing and quote-sent requests cancel directly only if unpaid, with no paid or pending payment and no approved quote or mockup.
- Approved, paid, in-production and ready orders create a cancellation request for Moore Made to review. No status change or refund occurs.
- Shipped and completed orders use the existing Message Moore Made option.

Every submission is saved once per order and appears as an unread customer message in the admin order conversation. Admins review and reply using Messages, and can use the existing order status control to mark an accepted request Cancelled. Customer Account shows a pending-request note after refresh. Refunds or payment adjustments remain manual; this feature does not issue them.

Direct cancellation, expiration of unapproved quotes, closure of the roster, and the customer/admin message are one database transaction. A failure rolls them all back. Database guards serialize approvals and payment actions against the order and block new approvals or pending/paid payment writes after cancellation. Saved artwork, receipts and order history are preserved. Legacy roster mockup-approval and mockup follow-up endpoints also check the cancelled status.

The RPC is executable by the service role only; the signed-in API supplies the verified customer ID. Customers can read only their own cancellation records.

Validation: isolated PostgreSQL fixtures exercise direct cancellation, ownership, approval/payment review rules, duplicate submissions, blocked old approval/payment actions, shipped/completed restrictions, and transactional rollback. These are not a live Supabase or true multi-connection contention test. Actual component fixtures verify reason/confirmation gates and accurate pending-review messaging at 320, 393 and 1280 pixels.
