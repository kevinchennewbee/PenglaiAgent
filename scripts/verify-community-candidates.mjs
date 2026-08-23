import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import https from "node:https";
import { ROOT } from "./lib/repo.mjs";
import { EXIT_BY_VERDICT } from "./lib/exit-contract.mjs";
import { beginEvidenceRun, finishEvidenceRun, HOST_TARGET, recordArtifact } from "./lib/evidence-dir.mjs";

const run = beginEvidenceRun({ command: "verify:community-candidates", target: HOST_TARGET });
const ledger = readFileSync(join(ROOT, "docs/0.5.5/COMMUNITY_REVIEW_LEDGER.md"), "utf8");
if (/curl\s*\|\s*bash/.test(ledger)) {
  const manifest = finishEvidenceRun(run, "FAIL", "ledger contains curl|bash");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

function fetchHttps(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "user-agent": "penglai-community-audit" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchHttps(res.headers.location).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("timeout")));
  });
}

function parseLedger(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("|") || line.includes("Candidate") || line.includes("---")) continue;
    const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cols.length < 6) continue;
    rows.push({
      name: cols[0],
      repo: cols[1],
      commit: cols[2],
      license: cols[3],
      dshExact: cols[4],
      verdict: cols[5],
      reason: cols.slice(6).join(" "),
    });
  }
  return rows;
}

const rows = parseLedger(ledger);
const audits = [];
const work = mkdtempSync(join(tmpdir(), "penglai-community-"));
try {
  for (const row of rows) {
    const audit = {
      name: row.name,
      repo: row.repo,
      commit: row.commit,
      licenseClaim: row.license,
      ledgerVerdict: row.verdict,
      pinned: /^[0-9a-f]{7,40}$/i.test(row.commit),
      fetched: false,
      licenseFile: false,
      pipeToShell: false,
      packageJson: false,
      dshExact: false,
      dryLoad: "NOT_RUN",
      machineVerdict: "QUARANTINED",
      reason: row.reason,
    };
    if (!audit.pinned) {
      audit.reason = "commit is not a pinned SHA; refuse to install";
      audits.push(audit);
      continue;
    }
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(row.repo)) {
      audit.reason = "repo is not owner/name";
      audits.push(audit);
      continue;
    }
    const url = `https://codeload.github.com/${row.repo}/tar.gz/${row.commit}`;
    try {
      const res = await fetchHttps(url);
      audit.httpStatus = res.status;
      if (res.status !== 200 || res.body.length < 64) {
        audit.reason = `github archive fetch failed status=${res.status}`;
        audits.push(audit);
        continue;
      }
      audit.fetched = true;
      audit.archiveSha256 = createHash("sha256").update(res.body).digest("hex");
      audit.archiveBytes = res.body.length;
      const tarPath = join(work, `${row.name.replace(/\s+/g, "-")}.tar.gz`);
      writeFileSync(tarPath, res.body, { mode: 0o600 });
      recordArtifact(run, tarPath, "application/gzip");
      const extract = join(work, row.name.replace(/\s+/g, "-"));
      mkdirSync(extract, { recursive: true, mode: 0o700 });
      const unpacked = spawnSync("tar", ["-tzf", tarPath], { encoding: "utf8", timeout: 15000 });
      if (unpacked.status !== 0) {
        audit.reason = "archive listing failed";
        audits.push(audit);
        continue;
      }
      if (unpacked.stdout.split("\n").some((name) => name.includes("..") || name.startsWith("/"))) {
        audit.reason = "archive path traversal";
        audit.machineVerdict = "REJECTED";
        audits.push(audit);
        continue;
      }
      spawnSync("tar", ["-xzf", tarPath, "-C", extract], { encoding: "utf8", timeout: 15000 });
      const files = [];
      const walk = (dir) => {
        for (const name of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, name.name);
          if (name.isDirectory()) walk(p);
          else files.push(p);
        }
      };
      walk(extract);
      audit.licenseFile = files.some((p) => /license/i.test(p));
      const blob = files.map((p) => readFileSync(p, "utf8")).join("\n");
      audit.pipeToShell = /curl\s*\|\s*bash|wget\s*\|\s*sh/.test(blob);
      audit.packageJson = files.some((p) => p.endsWith("package.json"));
      audit.dshExact = /0\.1\.1-rc\.2/.test(blob);
      if (audit.pipeToShell) {
        audit.machineVerdict = "REJECTED";
        audit.reason = "install script uses pipe-to-shell";
      } else {
        audit.machineVerdict = "QUARANTINED";
        audit.dryLoad = "NOT_RUN";
        audit.reason = `${row.reason || "not approved for 0.5.5 catalog"}; fetched=${audit.archiveSha256.slice(0, 12)}`;
      }
    } catch (error) {
      audit.reason = error instanceof Error ? error.message : "fetch error";
    }
    audits.push(audit);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const approved = audits.filter((row) => row.machineVerdict === "APPROVED");
writeFileSync(join(run.dir, "community-audits.json"), JSON.stringify(audits, null, 2));
if (existsSync(join(run.dir, "community-audits.json"))) {
  recordArtifact(run, join(run.dir, "community-audits.json"), "application/json");
}

const fetched = audits.filter((row) => row.fetched).length;
const unpinned = audits.filter((row) => !row.pinned).length;
const verdict = approved.length === 0 && audits.length === rows.length ? "PASS" : "FAIL";
const reason =
  approved.length === 0
    ? `community catalog remains empty; audited=${audits.length} fetched=${fetched} unpinned=${unpinned}`
    : "community plugin was approved without a product decision";
const manifest = finishEvidenceRun(run, verdict, reason, {
  approvedCount: approved.length,
  auditCount: audits.length,
  fetched,
  unpinned,
});
const line = JSON.stringify({
  verdict: manifest.verdict,
  command: "verify:community-candidates",
  approvedCount: approved.length,
  fetched,
  reason: manifest.reason,
  dir: run.dir,
});
if (verdict === "PASS") console.log(line);
else console.error(line);
process.exit(EXIT_BY_VERDICT[manifest.verdict] ?? 1);
