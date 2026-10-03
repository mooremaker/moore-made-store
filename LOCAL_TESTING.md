# Localhost testing branch

Vercel automatic deployments are disabled for `localhost-testing` in vercel.json.
This branch is for local review; do not merge it to main or manually deploy it.

First setup in your Moore Made PowerShell folder:

```powershell
git fetch origin
git switch --track origin/localhost-testing
npm run qa
npm run dev
```

Later updates (stop the server with Ctrl+C first):

```powershell
git pull --ff-only
npm run qa
npm run dev
```

Open http://localhost:3000/workspace/admin using the port printed in PowerShell.
`npm run dev` is intentionally disconnected on this branch. Sample forms are
editable, but saves, uploads, emails, tax, payments and order changes are blocked.
`npm run qa` compiles and runs Next.js TypeScript validation using disconnected
settings. Existing environment files are preserved. No database migration is
needed for sample testing. Real draft persistence and approval-trigger testing
require a separate test database and the phase6_66 migration; neither is applied.

Before final publication, restore the ordinary dev script and separately validate
real integrations and the migration. Only publish after explicit user approval.
