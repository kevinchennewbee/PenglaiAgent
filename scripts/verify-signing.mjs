import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  inspectPackagedCandidate,
  packagedAppForTarget,
  PACKAGED_TARGETS,
} from "./lib/packaged-candidate.mjs";
import { ROOT } from "./lib/repo.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { finish } from "./lib/exit-contract.mjs";
import {
  evaluateWindowsAuthenticode,
  WINDOWS_AUTHENTICODE_COMMAND,
} from "./lib/signing-contract.mjs";

function runCodesign(args) {
  const r = spawnSync("codesign", args, { encoding: "utf8" });
  return {
    status: r.status ?? 1,
    text: `${r.stdout ?? ""}\n${r.stderr ?? ""}`,
  };
}

const expectedTarget = process.env.PENGLAI_TARGET ?? "darwin-aarch64";
const source = requireCleanCandidateSource();
if (!source.ok) {
  finish("STALE", {
    command: "verify:signing",
    reason: source.reason,
    ...source.git,
  });
}
const git = source.git;
const app = packagedAppForTarget(ROOT, expectedTarget);
const packaged = inspectPackagedCandidate({
  app,
  candidateSha: git.head,
  expectedTarget,
});
if (packaged.verdict !== "PASS") {
  finish(packaged.verdict, {
    command: "verify:signing",
    reason: packaged.reason,
    app,
    sourceSha: git.head,
    expectedTarget,
  });
}

if (expectedTarget === "win32-x86_64") {
  if (process.platform !== "win32") {
    finish("BLOCKED", {
      command: "verify:signing",
      reason: "Windows Authenticode state requires a native Windows verifier",
      app,
      sourceSha: git.head,
      expectedTarget,
    });
  }
  const installer = join(ROOT, PACKAGED_TARGETS[expectedTarget].dmgRelative);
  const binaries = [join(app, "Penglai.exe"), installer];
  if (binaries.some((path) => !existsSync(path))) {
    finish("INCOMPLETE", {
      command: "verify:signing",
      reason: "exact Windows app or installer is missing",
      binaries,
      sourceSha: git.head,
      expectedTarget,
    });
  }
  const records = binaries.map((path) => {
    const result = spawnSync(
      "pwsh.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        WINDOWS_AUTHENTICODE_COMMAND,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PENGLAI_SIGNATURE_TARGET: path },
      },
    );
    return {
      path,
      status: String(result.stdout ?? "").trim(),
      processStatus: result.status ?? 1,
      error: String(result.stderr ?? "").trim(),
    };
  });
  const invocationFailure = records.find(
    (record) => record.processStatus !== 0 || record.status.length === 0,
  );
  if (invocationFailure) {
    finish("FAIL", {
      command: "verify:signing",
      reason: "native Authenticode inspection failed",
      records,
      sourceSha: git.head,
      target: expectedTarget,
    });
  }
  const contract = evaluateWindowsAuthenticode(records);
  if (contract.verdict !== "PASS") {
    finish("FAIL", {
      command: "verify:signing",
      reason: contract.reason,
      records,
      sourceSha: git.head,
      target: expectedTarget,
    });
  }
  const summary = [
    "Penglai 0.5.9 community-verified Windows unsigned contract",
    `app=${app}`,
    `installer=${installer}`,
    `sourceSha=${packaged.release.sourceSha}`,
    `target=${expectedTarget}`,
    ...records.map((record) => `${record.path}=Authenticode ${record.status}`),
    "authenticode=false",
    "notarized=false",
  ].join("\n");
  mkdirSync(join(ROOT, "dist"), { recursive: true });
  writeFileSync(
    join(ROOT, "dist/authenticode-verification.txt"),
    `${summary}\n`,
  );
  finish("PASS", {
    command: "verify:signing",
    signatureKind: "unsigned-nsis",
    developerIdSigned: false,
    notarized: false,
    authenticode: false,
    records: records.map(({ path, status }) => ({ path, status })),
    app,
    installer,
    sourceSha: packaged.release.sourceSha,
    target: expectedTarget,
  });
}

const verified = runCodesign(["--verify", "--deep", "--strict", "--verbose=2", app]);
if (verified.status !== 0) {
  console.error("codesign --verify --deep --strict failed");
  process.stderr.write(verified.text);
  process.exit(1);
}
const display = runCodesign(["-dv", "--verbose=2", app]);
const text = `${display.text}\n${verified.text}`;
const adhoc = /Signature=adhoc|flags=.*adhoc|\badhoc\b/i.test(text);
const developerId = /Developer ID Application/i.test(text);
if (developerId) {
  console.error("this local-acceptance contract expects ad-hoc, not Developer ID");
  process.exit(1);
}
if (!adhoc) {
  console.error("codesign display is not ad-hoc", display.text);
  process.exit(1);
}

const summary = ["Penglai 0.5.9 community-verified ad-hoc contract", `app=${app}`, `sourceSha=${packaged.release.sourceSha}`, `target=${expectedTarget}`, "codesign --verify --deep --strict --verbose=2: PASS", "signatureKind=adhoc", "developerIdSigned=false", "notarized=false", "authenticode=false", display.text.trim()].join("\n");
mkdirSync(join(ROOT, "dist"), { recursive: true });
writeFileSync(join(ROOT, "dist/codesign-verification.txt"), `${summary}\n`);
finish("PASS", {
  command: "verify:signing",
  signatureKind: "adhoc",
  developerIdSigned: false,
  notarized: false,
  authenticode: false,
  app,
  sourceSha: packaged.release.sourceSha,
  target: expectedTarget,
});
