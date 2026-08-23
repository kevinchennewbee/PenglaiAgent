import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, gitState } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { hostTarget, inspectClosureCredential, stagingForTarget } from "./lib/closure-credential.mjs";
import {
  EmbeddedDshSupervisor,
  activatePrivateProfile,
  ensurePrivateHome,
  installFirstPartyPlugins,
  matchesPlugin,
  processesMatching,
  resolveRuntimeLayout,
  resolveUserLayout,
  rowIsLoaded,
} from "../packages/runtime/src/index.ts";
import { setPatchDisabled } from "../packages/plugin-center/src/profile-tx.ts";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const target = hostTarget();
const staging = argValue("--staging", stagingForTarget(ROOT, target));
const git = gitState();
const closure = inspectClosureCredential({ staging, candidateSha: git.head, expectedTarget: target });
if (closure.verdict !== "PASS") {
  finish(closure.verdict, { command: "verify:profile", target, reason: closure.reason });
}

const layout = resolveRuntimeLayout(staging);
if (!layout.nodeBin.startsWith("/") || !layout.dshEntry.startsWith("/")) {
  finish("FAIL", { command: "verify:profile", target, reason: "embedded paths are not absolute" });
}
if (!existsSync(layout.nodeBin) || !existsSync(layout.dshEntry)) {
  finish("FAIL", { command: "verify:profile", target, reason: "closure credential present but embedded runtime is missing" });
}

const modes = process.argv.includes("--voice-matrix")
  ? ["fresh", "im-only", "im-asr", "im-tts", "full"]
  : ["fresh"];

function selectedPlugins(mode) {
  const builtins = ["@penglai/office", "@penglai/memory"];
  if (mode === "fresh") return builtins;
  if (mode === "im-only") return [...builtins, "@penglai/im"];
  if (mode === "im-asr") return [...builtins, "@penglai/im", "@penglai/asr"];
  if (mode === "im-tts") return [...builtins, "@penglai/im", "@penglai/moss-tts"];
  return [
    ...builtins,
    "@penglai/im",
    "@penglai/asr",
    "@penglai/moss-tts",
    "@penglai/budget",
    "@penglai/companion",
  ];
}

function configurePluginMode(profileWeb, mode) {
  const patchPath = join(profileWeb, "cordis.patch.yml");
  let patch = readFileSync(patchPath, "utf8");
  const selected = new Set(selectedPlugins(mode));
  for (const id of [
    "@penglai/im",
    "@penglai/asr",
    "@penglai/moss-tts",
    "@penglai/memory",
    "@penglai/office",
    "@penglai/budget",
    "@penglai/companion",
  ]) {
    patch = setPatchDisabled(patch, id, !selected.has(id));
  }
  writeFileSync(patchPath, patch, { mode: 0o600 });
}

function loaded(proof, names) {
  return proof.entries.some((entry) => matchesPlugin(entry, names) && rowIsLoaded(entry));
}

const modeRecords = [];
let failure;
for (const mode of modes) {
  const userRoot = mkdtempSync(join(tmpdir(), `penglai-verify-profile-${mode}-`));
  const user = resolveUserLayout(userRoot);
  const supervisor = new EmbeddedDshSupervisor(layout);
  try {
    ensurePrivateHome(user);
    activatePrivateProfile(layout, user);
    configurePluginMode(user.profileWeb, mode);
    installFirstPartyPlugins(layout, user.profileWeb, user.transactions, selectedPlugins(mode));
    const { port } = await supervisor.start(user, { PENGLAI_PLUGINS_DIR: layout.pluginsDir });
    if (supervisor.state !== "healthy" || !supervisor.health) {
      throw new Error("supervisor not healthy after HTTP+inventory wait");
    }
    const proof = supervisor.health.inventory;
    if (!proof.ok || !proof.credentials || !proof.pluginCenter || !proof.smokeDisabled) {
      throw new Error(`inventory not acceptable ${JSON.stringify(proof)}`);
    }
    const im = loaded(proof, ["@penglai/im", "penglai-im"]);
    const asr = loaded(proof, ["@penglai/asr", "penglai-asr"]);
    const tts = loaded(proof, ["@penglai/moss-tts", "penglai-moss-tts"]);
    const office = loaded(proof, ["@penglai/office", "penglai-office"]);
    const memory = loaded(proof, ["@penglai/memory", "penglai-memory"]);
    const expectedAsr = mode === "full" || mode === "im-asr";
    const expectedTts = mode === "full" || mode === "im-tts";
    const expectedIm = mode !== "fresh";
    if (im !== expectedIm || asr !== expectedAsr || tts !== expectedTts || !office || !memory) {
      throw new Error(`plugin inventory mismatch mode=${mode} im=${im} asr=${asr} tts=${tts} office=${office} memory=${memory}`);
    }
    await supervisor.stop();
    const leftover = processesMatching(user.dshHome);
    if (leftover.length) throw new Error(`leftover processes ${JSON.stringify(leftover)}`);
    modeRecords.push({
      mode,
      port,
      http: supervisor.health.http,
      credentials: proof.credentials,
      pluginCenter: proof.pluginCenter,
      im,
      smokeDisabled: proof.smokeDisabled,
      asr,
      tts,
      leftovers: 0,
    });
  } catch (err) {
    try {
      await supervisor.stop();
    } catch {
      /* already stopped */
    }
    failure = {
      mode,
      reason: err instanceof Error ? err.message : String(err),
      leftovers: processesMatching(user.dshHome),
      logs: supervisor.logs.slice(-4000),
    };
    break;
  } finally {
    rmSync(userRoot, { recursive: true, force: true });
  }
}

const primary = modeRecords.find((record) => record.mode === "fresh") ?? modeRecords[0];
const finalRecord = failure
  ? {
      command: "verify:profile",
      verdict: "FAIL",
      target,
      sourceSha: git.head,
      ...failure,
      modes: modeRecords,
    }
  : {
      command: "verify:profile",
      verdict: "PASS",
      target,
      sourceSha: git.head,
      manifestSha256: closure.manifestSha256,
      port: primary?.port,
      http: primary?.http,
      inventory: primary
        ? {
            credentials: primary.credentials,
            pluginCenter: primary.pluginCenter,
            im: primary.im,
            smokeDisabled: primary.smokeDisabled,
          }
        : undefined,
      leftovers: 0,
      modes: modeRecords,
    };

finish(finalRecord.verdict, finalRecord);
