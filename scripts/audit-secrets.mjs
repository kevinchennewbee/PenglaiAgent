import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";

const r = spawnSync(
  "git",
  [
    "grep",
    "-I",
    "-n",
    "-E",
    "BEGIN (RSA |OPENSSH )?PRIVATE KEY|weixin.*token=.+|bot_token=|sk-[A-Za-z0-9]{20,}|local-voices/[A-Za-z0-9._-]+\\.(wav|pcm)|transcript[\"']?\\s*[:=]\\s*[\"'][^\"']{12,}|grantedPath[\"']?\\s*[:=]\\s*[\"']/(Users|home)/",
  ],
  { cwd: ROOT, encoding: "utf8" },
);
if (r.status === 1) {
  console.log("audit:secrets ok");
  process.exit(0);
}
if (r.status !== 0) {
  process.stderr.write(r.stderr || r.stdout || "git grep failed\n");
  process.exit(r.status ?? 1);
}
const lines = (r.stdout || "")
  .split("\n")
  .filter(Boolean)
  .filter((l) => !l.includes("audit-secrets.mjs"))
  .filter((l) => !/\.test\.ts:/.test(l))
  .filter((l) => !/scanExportText|assertProductionHasNoFixtureKey|lock\.includes\(|\.test\(source\)/.test(l));
if (lines.length) {
  console.error(lines.join("\n"));
  process.exit(1);
}
console.log("audit:secrets ok");
