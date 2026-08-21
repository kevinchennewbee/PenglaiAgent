import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";

import { CLOSURE_CREDENTIAL_SCHEMA } from "./closure-credential.mjs";

export const PACKAGED_TARGETS = Object.freeze({
  "darwin-aarch64": Object.freeze({
    buildTarget: "darwin-arm64",
    appRelative: "dist/Penglai-v0.5.1-arm64-from-dmg/Penglai.app",
    dmgRelative: "dist/Penglai_0.5.1_macos_aarch64.dmg",
  }),
  "darwin-x86_64": Object.freeze({
    buildTarget: "darwin-x64",
    appRelative: "dist/Penglai-v0.5.1-x64-from-dmg/Penglai.app",
    dmgRelative: "dist/Penglai_0.5.1_macos_x64.dmg",
  }),
});

function readJson(path, label) {
  if (!existsSync(path)) return { error: `${label} missing` };
  try {
    return { value: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { error: `${label} malformed` };
  }
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function packagedAppForTarget(root, expectedTarget) {
  const spec = PACKAGED_TARGETS[expectedTarget];
  if (!spec) throw new Error(`unsupported packaged target ${expectedTarget}`);
  return join(root, spec.appRelative);
}

/**
 * Inspect the exact app copied back from the mounted installer. A staging tree,
 * an unsigned package directory, or an app built for a different source/target
 * is never an acceptable substitute.
 */
export function inspectPackagedCandidate({
  app,
  candidateSha,
  expectedTarget,
}) {
  const spec = PACKAGED_TARGETS[expectedTarget];
  if (!spec)
    return {
      verdict: "FAIL",
      reason: `unsupported packaged target ${expectedTarget}`,
    };
  if (!app || !existsSync(join(app, "Contents/Info.plist"))) {
    return {
      verdict: "INCOMPLETE",
      reason: "exact from-DMG Penglai.app missing",
      app,
    };
  }

  const resources = join(app, "Contents/Resources");
  const releasePath = join(resources, "release-info.json");
  const manifestPath = join(resources, "runtime-manifest.json");
  const credentialPath = join(resources, "closure-credential.json");
  const releaseRead = readJson(releasePath, "embedded release identity");
  const manifestRead = readJson(manifestPath, "embedded runtime manifest");
  const credentialRead = readJson(
    credentialPath,
    "embedded closure credential",
  );
  const malformed = [
    releaseRead.error,
    manifestRead.error,
    credentialRead.error,
  ].filter(Boolean);
  if (malformed.length) {
    return { verdict: "STALE", reason: malformed.join("; "), app };
  }

  const release = releaseRead.value;
  const manifest = manifestRead.value;
  const credential = credentialRead.value;
  if (release.sourceSha !== candidateSha) {
    return {
      verdict: "STALE",
      reason: `embedded source ${release.sourceSha ?? "missing"} != candidate ${candidateSha}`,
      app,
    };
  }
  if (release.treeDirty !== false) {
    return {
      verdict: "FAIL",
      reason: "embedded release identity is dirty",
      app,
    };
  }
  if (
    release.productName !== "Penglai" ||
    release.productVersion !== "0.5.1" ||
    release.generationId !== "penglai-dsh-v0.5" ||
    release.trustTier !== "community-verified" ||
    release.targetPlatform !== spec.buildTarget
  ) {
    return {
      verdict: "FAIL",
      reason: "embedded release identity mismatch",
      app,
    };
  }
  if (!/^[0-9a-f]{64}$/.test(String(release.publicExportTreeSha256 ?? ""))) {
    return {
      verdict: "FAIL",
      reason: "embedded public export tree hash is missing or invalid",
      app,
    };
  }
  if (
    credential.schemaVersion !== CLOSURE_CREDENTIAL_SCHEMA ||
    credential.sourceSha !== candidateSha ||
    credential.target !== expectedTarget
  ) {
    return {
      verdict: "FAIL",
      reason: "embedded closure source/target identity mismatch",
      app,
    };
  }
  if (
    manifest.release !== "0.5.1" ||
    manifest.target !== expectedTarget ||
    manifest.dsh !== release.dsh ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  ) {
    return {
      verdict: "FAIL",
      reason: "embedded runtime manifest identity mismatch",
      app,
    };
  }
  const manifestSha256 = sha256File(manifestPath);
  if (credential.manifestSha256 !== manifestSha256) {
    return {
      verdict: "STALE",
      reason: "embedded runtime manifest changed after closure completion",
      app,
    };
  }

  const seen = new Set();
  for (const row of manifest.files) {
    if (
      !row ||
      typeof row.path !== "string" ||
      !/^[0-9a-f]{64}$/.test(String(row.sha256 ?? "")) ||
      !Number.isSafeInteger(row.size) ||
      row.size < 0 ||
      isAbsolute(row.path) ||
      seen.has(row.path)
    ) {
      return {
        verdict: "FAIL",
        reason:
          "embedded runtime manifest contains an invalid or duplicate file entry",
        app,
      };
    }
    seen.add(row.path);
    const file = resolve(resources, row.path);
    if (!file.startsWith(`${resolve(resources)}${sep}`) || !existsSync(file)) {
      return {
        verdict: "FAIL",
        reason: `embedded closure file missing or escaped: ${row.path}`,
        app,
      };
    }
    const stat = lstatSync(file);
    if (
      !stat.isFile() ||
      stat.size !== row.size ||
      sha256File(file) !== row.sha256
    ) {
      return {
        verdict: "STALE",
        reason: `embedded closure file bytes mismatch: ${row.path}`,
        app,
      };
    }
  }

  const nodeBin = join(resources, "runtime/node/bin/node");
  const dshBin = join(resources, "runtime/dsh/lib/bin.js");
  if (!existsSync(nodeBin) || !existsSync(dshBin)) {
    return {
      verdict: "FAIL",
      reason: "embedded Node or DSH executable missing",
      app,
    };
  }
  return {
    verdict: "PASS",
    app,
    resources,
    nodeBin,
    dshBin,
    release,
    manifest,
    credential,
    manifestSha256,
    expectedTarget,
  };
}

export function inspectDmgEvidence({ root, packaged, evidencePath }) {
  const spec = PACKAGED_TARGETS[packaged.expectedTarget];
  const dmgPath = join(root, spec.dmgRelative);
  const evidenceRead = readJson(evidencePath, "local DMG evidence");
  if (evidenceRead.error || !existsSync(dmgPath)) {
    return {
      verdict: "INCOMPLETE",
      reason: evidenceRead.error ?? "DMG missing",
      dmgPath,
    };
  }
  const evidence = evidenceRead.value;
  const actualSha256 = sha256File(dmgPath);
  if (
    evidence.sourceSha !== packaged.release.sourceSha ||
    evidence.target !== packaged.expectedTarget ||
    evidence.sha256 !== actualSha256 ||
    evidence.treeDirty !== false ||
    evidence.signatureKind !== "adhoc" ||
    evidence.publicExportTreeSha256 !== packaged.release.publicExportTreeSha256
  ) {
    return {
      verdict: "STALE",
      reason: "DMG evidence does not bind exact source, target, and bytes",
      dmgPath,
    };
  }
  return { verdict: "PASS", dmgPath, actualSha256, evidence };
}
