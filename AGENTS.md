# Moore Made — chat development workspace

## Publication boundary
- User authorized GitHub branch localhost-testing for local pull/QA/dev testing on October 3, 2026.
- Upload only fully checked batches to this branch, with vercel.json disabling deployments for localhost-testing in the first published commit.
- Do not push or merge main, create PRs, invoke deployments, or change production settings. Final publication still requires explicit approval.
- User prefers localhost and minimal deployment usage; no Vercel previews are needed for this workflow.
- Keep the local generic push safeguard intact; authorized testing branch uploads may use GitHub tools after checking deployment suppression.

## Safe previews
- This checkout is an isolated copy of mooremaker/moore-made-store, based on commit 2202a1a.
- Use local preview mode; do not import production credentials or connect to the live Supabase database, Stripe, or Resend.
- Use clearly identified fixtures for authenticated admin/customer workflows. Never mutate Taylor's live order MM-284563.
- Preview launcher blanks integration credentials from inherited environment and local environment files before Next starts. Normal npm run dev retains the existing application behavior.
- Preserve current auth, tax, payments, proof history, quote corrections, and customer permissions in the final implementation.
- Review upload/Pasted text(20261001-215028).txt in the parent workspace for redesign requirements.
- Local preview infrastructure is internal; do not present its URL as a user-accessible link. Show screenshots or appropriate in-chat artifacts and state interactive preview limitations plainly.

## Working practices
- Preserve package-lock.json and existing dependencies.
- Check TypeScript and the build when appropriate. Verify desktop/mobile UI for changed workflows.
- Keep this workspace on its local redesign branch; maintain local commits as checkpoints.
