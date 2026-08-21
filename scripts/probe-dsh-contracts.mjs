import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";

const require = createRequire(join(ROOT, "packages/dsh-bridge/package.json"));
const outDir = join(ROOT, "evidence/generated");
mkdirSync(outDir, { recursive: true });

const dshBin = require.resolve("@deepseek-ai/dsh/lib/bin.js");
const cred = require.resolve("@deepseek-ai/dsh-credentials/package.json");
const session = require.resolve("@deepseek-ai/dsh-session/package.json");
const home = join(ROOT, ".tmp-probe-dsh-home-rc1");
mkdirSync(home, { recursive: true });
const dump = execFileSync(process.execPath, [dshBin, "--profile", "web", "--dump-default-config"], {
  encoding: "utf8",
  env: { ...process.env, DSH_HOME: home, PATH: process.env.PATH },
});
const report = {
  dsh: "0.1.1-rc.1",
  credentialsPackage: cred,
  sessionPackage: session,
  hasCredentialsLocal: dump.includes("dsh-credentials-local"),
  hasInventory: dump.includes("plugin-inventory") || dump.includes("dsh-host-plugin-inventory"),
  hasPluginsTab: dump.includes("settings.plugins") || dump.includes("dsh-client-ui-settings-plugins"),
  hasOnboarding: dump.includes("settings.onboarding") || dump.includes("dsh-client-ui-settings-general"),
  sessionEvent: "session/event",
  claimedEvent: "agent/inbox/claimed",
  resumeReturns: "AgentHandle",
};
if (!report.hasCredentialsLocal || !report.hasInventory) {
  console.error("official dump missing required rows", report);
  process.exit(1);
}
writeFileSync(join(outDir, "dsh-contracts.json"), JSON.stringify(report, null, 2));
console.log("probe-dsh-contracts", JSON.stringify(report));
