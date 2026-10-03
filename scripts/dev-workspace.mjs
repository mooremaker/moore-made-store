import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const incoming = process.argv.slice(2);
const supervised = incoming.includes("--host");
const preview = supervised || incoming.includes("--preview");
const args = ["dev", "--webpack"];

for (let i = 0; i < incoming.length; i++) {
  const arg = incoming[i];
  if (arg === "--preview" || arg === "--strictPort") continue;
  args.push(arg === "--host" ? "--hostname" : arg);
}

const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
const integrationKey = /^(NEXT_PUBLIC_SUPABASE_|SUPABASE_|STRIPE_|NEXT_PUBLIC_STRIPE_|RESEND_|MOORE_MADE_(ADMIN_EMAIL|FROM_EMAIL|PUBLIC_URL)|ADMIN_SESSION_SECRET|SITE_URL)/;

if (preview) {
  // Defined environment entries take precedence over Next's .env loader.
  // Blank every integration key found in either source, without printing values.
  for (const key of Object.keys(env)) if (integrationKey.test(key)) env[key] = "";
  for (const file of readdirSync(process.cwd()).filter((name) => /^\.env(?:\.|$)/.test(name) && name !== ".env.example")) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/);
      if (match && integrationKey.test(match[1])) env[match[1]] = "";
    }
  }
  env.MOORE_MADE_PREVIEW = "1";
  console.log("Local test preview: integrations disconnected; server actions blocked.");
}

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", ...args], { stdio: "inherit", env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
