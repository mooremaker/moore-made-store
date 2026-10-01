# Customer email follow-ups

In an admin order, open **Sent mockup history** and choose **Send follow-up** on the latest pending proof. Review recipients, edit the suggested message, and choose whether to attach the saved mockups. **Review follow-up** displays the draft; **Send follow-up email** sends it. The original proof version and approval link are retained.

Approved or superseded proofs cannot receive a mockup reminder. Missing attachments stop the send; the admin can choose a link-only message instead. Sending requires the existing admin role and MFA checks. Partial retries target failed recipients only and retain the send identifier. Resend idempotency protects interrupted retries within its provider window; refresh starts a new composer, so check email activity before deliberately starting another send.

The existing notification email log stores recipient, subject, timestamp, provider ID, and success/failure. Successful follow-ups also enter customer message history when the order has a matching customer account. Guest orders still retain the admin email audit log. If audit saving fails after email acceptance, the composer warns that the email was sent and should not be resent just to repair history.

In **Customer emails & follow-ups**, **Draft follow-up** on a sent email prepares an editable text-only update. Review it before sending. Saved mockup attachments and approval links are included only by the mockup follow-up composer.

No new SQL migration is needed. The existing notification history and mockup review history tables must already be installed (Phases 6.29 and 6.65). The mockup endpoint checks history availability before sending.

Validation: `node --test tests/follow-up.test.cjs` exercises authorization, invalid recipients, attachment ownership, approved/replaced proofs, missing history/files, attachment and link-only sends, partial failures, and retry IDs. Actual component browser fixtures verify review-before-send and partial retries at 320, 393 and 1280 pixels. Sending and database operations use fixtures; live delivery is not exercised.
