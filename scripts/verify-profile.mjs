import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { ROOT, gitState } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { hostTarget, inspectClosureCredential, stagingForTarget } from "./lib/closure-credential.mjs";
import {
  EmbeddedDshSupervisor,
  activateDshHomeBootPlan,
  activatePrivateProfile,
  ensurePrivateHome,
  installFirstPartyPlugins,
  exactPluginId,
  processesMatching,
  prepareDshHomeForBoot,
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
if (!isAbsolute(layout.nodeBin) || !isAbsolute(layout.dshEntry)) {
  finish("FAIL", { command: "verify:profile", target, reason: "embedded paths are not absolute" });
}
if (!existsSync(layout.nodeBin) || !existsSync(layout.dshEntry)) {
  finish("FAIL", { command: "verify:profile", target, reason: "closure credential present but embedded runtime is missing" });
}

const modes = process.argv.includes("--plugin-matrix") || process.argv.includes("--voice-matrix")
  ? ["fresh", "im-only", "im-asr", "im-tts", "budget", "companion", "full"]
  : ["fresh"];

function selectedPlugins(mode) {
  const builtins = ["@penglai/memory", "@penglai/im"];
  if (mode === "fresh") return builtins;
  if (mode === "im-only") return builtins;
  if (mode === "im-asr") return [...builtins, "@penglai/asr"];
  if (mode === "im-tts") return [...builtins, "@penglai/moss-tts"];
  if (mode === "budget") return [...builtins, "@penglai/budget"];
  if (mode === "companion") return [...builtins, "@penglai/budget", "@penglai/companion"];
  return [
    ...builtins,
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
    "@penglai/budget",
    "@penglai/companion",
  ]) {
    patch = setPatchDisabled(patch, id, !selected.has(id));
  }
  writeFileSync(patchPath, patch, { mode: 0o600 });
}

function loaded(proof, id) {
  return proof.entries.some((entry) => exactPluginId(entry, id) && rowIsLoaded(entry));
}

const modeRecords = [];
let failure;
for (const mode of modes) {
  const userRoot = mkdtempSync(join(tmpdir(), `penglai-verify-profile-${mode}-`));
  const homePlan = prepareDshHomeForBoot({ userRoot });
  const user = resolveUserLayout(userRoot, homePlan.dshHome);
  const supervisor = new EmbeddedDshSupervisor(layout);
  try {
    ensurePrivateHome(user, layout.appRoot);
    activatePrivateProfile(layout, user);
    configurePluginMode(user.profileWeb, mode);
    installFirstPartyPlugins(layout, user.profileWeb, user.transactions, selectedPlugins(mode), user.root);
    const { port } = await supervisor.start(user, { PENGLAI_PLUGINS_DIR: layout.pluginsDir });
    if (supervisor.state !== "healthy" || !supervisor.health) {
      throw new Error("supervisor not healthy after HTTP+inventory wait");
    }
    const proof = supervisor.health.inventory;
    if (!proof.ok || !proof.credentials || !proof.pluginCenter || !proof.memory || !proof.smokeDisabled) {
      throw new Error(`inventory not acceptable ${JSON.stringify(proof)}`);
    }
    for (const excluded of [
      "@penglai/office",
      "@deepseek-ai/dsh-office-to-pdf",
      "@deepseek-ai/dsh-client-ui-sidebar-documentpreview",
      "@deepseek-ai/libreoffice-kit",
    ]) {
      if (
        proof.entries.some(
          (entry) => exactPluginId(entry, excluded) && rowIsLoaded(entry),
        )
      ) {
        throw new Error(`excluded 0.6.6 plugin active: ${excluded}`);
      }
    }
    const im = loaded(proof, "@penglai/im");
    const asr = loaded(proof, "@penglai/asr");
    const tts = loaded(proof, "@penglai/moss-tts");
    const budget = loaded(proof, "@penglai/budget");
    const companion = loaded(proof, "@penglai/companion");
    const memory = proof.memory;
    const expectedAsr = mode === "full" || mode === "im-asr";
    const expectedTts = mode === "full" || mode === "im-tts";
    const expectedBudget = mode === "full" || mode === "budget" || mode === "companion";
    const expectedCompanion = mode === "full" || mode === "companion";
    const expectedIm = true;
    if (im !== expectedIm || asr !== expectedAsr || tts !== expectedTts || budget !== expectedBudget || companion !== expectedCompanion || !memory) {
      throw new Error(`plugin inventory mismatch mode=${mode} im=${im} asr=${asr} tts=${tts} budget=${budget} companion=${companion} memory=${memory}`);
    }
    activateDshHomeBootPlan({
      userRoot,
      plan: homePlan,
      validation: {
        dshVersion: "0.1.7-alpha.2",
        officialDocument: true,
        dshHealthy: true,
        profileReady: true,
        requiredPluginsActive: ["@penglai/memory"],
        validatedAt: new Date().toISOString(),
      },
    });
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
      budget,
      companion,
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
