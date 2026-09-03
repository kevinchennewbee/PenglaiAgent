import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { evidenceName, installerForTarget, RELEASE_TARGETS } from "./lib/release-targets.mjs";

const allowed = new Set([
  "verify:artifact",
  "verify:closure",
  "verify:fuses",
  "verify:installed",
  "verify:profile",
  "verify:signing",
  "verify:upgrade-uninstall",
]);
const index = process.argv.indexOf("--command");
const command = index >= 0 ? process.argv[index + 1] : "";
if (!allowed.has(command)) {
  finish("FAIL", { command: "verify:native-set", reason: `unsupported native gate ${command || "missing"}` });
}

const source = requireCleanCandidateSource();
if (!source.ok) finish("STALE", { command: "verify:native-set", gate: command, reason: source.reason, ...source.git });

const basename = command.replaceAll(":", "-");
const records = [];
for (const target of RELEASE_TARGETS) {
  const installerEvidencePath = join(ROOT, "evidence", "generated", evidenceName("local-installer", target));
  if (!existsSync(installerEvidencePath)) {
    finish("INCOMPLETE", { command: "verify:native-set", gate: command, reason: `missing installer evidence for ${target}`, target });
  }
  const installerEvidence = JSON.parse(readFileSync(installerEvidencePath, "utf8"));
  if (
    installerEvidence.target !== target ||
    installerEvidence.sourceSha !== source.git.head ||
    installerEvidence.installer !== installerForTarget(target) ||
    installerEvidence.treeDirty !== false ||
    !/^[0-9a-f]{64}$/.test(String(installerEvidence.sha256 ?? ""))
  ) {
    finish("STALE", { command: "verify:native-set", gate: command, reason: `installer evidence is stale for ${target}`, target });
  }
  const path = join(ROOT, "evidence", "generated", `${basename}-${target}.json`);
  if (!existsSync(path)) {
    finish("INCOMPLETE", {
      command: "verify:native-set",
      gate: command,
      reason: `missing ${command} evidence for ${target}`,
      target,
    });
  }
  let record;
  try {
    record = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    finish("FAIL", { command: "verify:native-set", gate: command, reason: `invalid evidence JSON for ${target}`, target });
  }
  if (
    record.command !== command ||
    record.verdict !== "PASS" ||
    record.target !== target ||
    record.sourceSha !== source.git.head
  ) {
    finish("STALE", {
      command: "verify:native-set",
      gate: command,
      reason: `${command} evidence is not an exact PASS for ${target}`,
      target,
    });
  }
  if (command === "verify:upgrade-uninstall") {
    const versions = [...(record.previousVersions ?? [])].sort();
    if (JSON.stringify(versions) !== JSON.stringify(["0.5.8", "0.5.9"]) || record.upgradePaths?.length !== 2 || record.upgradePaths.some((row) => row.verdict !== "PASS" || row.sourceSha !== source.git.head || row.current?.installerSha256 !== installerEvidence.sha256 || !row.upgradePreservedOwnerData || !row.uninstallPreservedOwnerData || !row.uninstallRemovedApp)) {
      finish("INCOMPLETE", { command: "verify:native-set", gate: command, reason: "both native upgrade paths must pass on these installer bytes", target });
    }
  }
  if (command === "verify:profile") {
    const modes = new Set(Array.isArray(record.modes) ? record.modes.map((row) => row?.mode) : []);
    const required = ["fresh", "im-only", "im-asr", "im-tts", "full"];
    if (!required.every((mode) => modes.has(mode))) {
      finish("INCOMPLETE", {
        command: "verify:native-set",
        gate: command,
        reason: `voice/profile matrix is incomplete for ${target}`,
        target,
      });
    }
  }
  const gateInstallerSha = command === "verify:installed"
    ? record.installerSha256
    : command === "verify:upgrade-uninstall"
      ? record.current?.installerSha256
      : null;
  if (gateInstallerSha !== null && gateInstallerSha !== installerEvidence.sha256) {
    finish("STALE", {
      command: "verify:native-set",
      gate: command,
      reason: `${command} is bound to different installer bytes for ${target}`,
      target,
    });
  }
  records.push({ target, sourceSha: record.sourceSha, installerSha256: installerEvidence.sha256 });
}

finish("PASS", { command: "verify:native-set", gate: command, sourceSha: source.git.head, targets: records });
