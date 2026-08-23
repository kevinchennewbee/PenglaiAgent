import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "evidence/releases/v0.2.0-alpha.1/wp0-probe");
mkdirSync(outDir, { recursive: true });
const require = createRequire(join(root, "apps/desktop/package.json"));

function run(argv, opts = {}) {
  const started = Date.now();
  let stdout = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(argv[0], argv.slice(1), {
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, ...(opts.env ?? {}) },
    });
  } catch (err) {
    exitCode = err.status ?? 1;
    stdout = String(err.stdout ?? "") + String(err.stderr ?? err.message);
  }
  return { argv, exitCode, durationMs: Date.now() - started, stdout };
}

const records = [];
records.push(run(["node", "-p", "process.version"]));
const dshPkg = require.resolve("@deepseek-ai/dsh/package.json");
const dsh = JSON.parse(readFileSync(dshPkg, "utf8"));
const dump = run([process.execPath, require.resolve("@deepseek-ai/dsh/lib/bin.js"), "--profile", "web", "--dump-default-config"], {
  env: { DSH_HOME: join(root, ".tmp-probe-dsh-home") },
});
records.push(dump);
writeFileSync(join(outDir, "web-dump-default-config.yml"), dump.stdout);
const hasCredentialsRow = dump.stdout.includes("dsh-credentials-local");
const hasInventory = dump.stdout.includes("dsh-host-plugin-inventory") || dump.stdout.includes("plugin-inventory");
const report = {
  generatedAt: new Date().toISOString(),
  dshName: dsh.name,
  dshVersion: dsh.version,
  dshPackage: dshPkg,
  hasCredentialsRow,
  hasInventory,
  nodeOfficialSha256: "db4b275b83736df67533529a18cc55de2549a8329ace6c7bcc68f8d22d3c9000",
  commands: records.map((r) => ({ argv: r.argv, exitCode: r.exitCode, durationMs: r.durationMs })),
};
writeFileSync(join(outDir, "upstream.json"), JSON.stringify(report, null, 2));
writeFileSync(join(outDir, "commands.jsonl"), records.map((r) => JSON.stringify({ argv: r.argv, exitCode: r.exitCode })).join("\n") + "\n");
if (dsh.version !== "0.1.1-rc.2" || !hasCredentialsRow || !hasInventory) {
  console.error("probe-r2 contract failed", report);
  process.exit(1);
}
console.log(JSON.stringify({ probe: "ok", dsh: dsh.version, hasCredentialsRow, hasInventory }));
void createHash;
void existsSync;
