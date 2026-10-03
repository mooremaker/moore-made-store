import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", MOORE_MADE_PREVIEW: "1" };
const integrationKey = /^(NEXT_PUBLIC_SUPABASE_|SUPABASE_|STRIPE_|NEXT_PUBLIC_STRIPE_|RESEND_|MOORE_MADE_(ADMIN_EMAIL|FROM_EMAIL|PUBLIC_URL)|ADMIN_SESSION_SECRET|SITE_URL)/;
for (const key of Object.keys(env)) if (integrationKey.test(key)) env[key] = "";
for (const file of readdirSync(process.cwd()).filter(name => /^\.env(?:\.|$)/.test(name) && name !== ".env.example")) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/);
    if (match && integrationKey.test(match[1])) env[match[1]] = "";
  }
}
env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "local-build-placeholder";
console.log("Local QA: production compile and TypeScript checks with integrations disconnected.");
const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"], { stdio: "inherit", env });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
