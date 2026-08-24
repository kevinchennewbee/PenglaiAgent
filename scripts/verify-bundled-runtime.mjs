import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";
import { requireCleanCandidateSource } from "./lib/candidate-source.mjs";
import { finish } from "./lib/exit-contract.mjs";
import { inspectPackagedCandidate, packagedAppForTarget } from "./lib/packaged-candidate.mjs";
import { nativeBlocked, parseTargetArg } from "./lib/release-targets.mjs";
import { beginEvidenceRun, finishEvidenceRun, recordCommand, HOST_TARGET } from "./lib/evidence-dir.mjs";
import { MnemonMemoryService } from "../packages/memory/src/engine/service.ts";
import {
  EmbeddedDshSupervisor,
  OwnerApprovalBroker,
  activatePrivateProfile,
  ensurePrivateHome,
  installFirstPartyPlugins,
  resolveRuntimeLayout,
  resolveUserLayout,
} from "../packages/runtime/src/index.ts";

const expectedTarget = parseTargetArg();
const source = requireCleanCandidateSource();
if (!source.ok) {
  finish("STALE", { command: "verify:bundled-runtime", reason: source.reason, ...source.git });
}
const blocked = nativeBlocked("verify:bundled-runtime", expectedTarget);
if (blocked) finish("BLOCKED", { command: "verify:bundled-runtime", ...blocked });

const run = beginEvidenceRun({ command: "verify:bundled-runtime", target: HOST_TARGET });
const app = packagedAppForTarget(ROOT, expectedTarget);
const packaged = inspectPackagedCandidate({ app, candidateSha: source.git.head, expectedTarget });
if (packaged.verdict !== "PASS") {
  const manifest = finishEvidenceRun(run, packaged.verdict, packaged.reason);
  finish(packaged.verdict, { command: "verify:bundled-runtime", reason: packaged.reason, dir: manifest.dir });
}

const resources = join(app, "Contents", "Resources");
const mnemonBin = join(resources, "mnemon", "mnemon");
// Exact from-DMG app resources mnemon; never the repo checkout binary.
const dataDir = mkdtempSync(join(tmpdir(), "penglai-bundled-mnemon-"));
const mnemon = (args, timeoutMs = 15_000) => {
  const started = Date.now();
  const result = spawnSync(mnemonBin, ["--data-dir", dataDir, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    env: { PATH: "/usr/bin:/bin", LANG: process.env.LANG ?? "C", TMPDIR: tmpdir() },
  });
  recordCommand(run, {
    argv: [mnemonBin, "--data-dir", "redacted", ...args],
    exitCode: result.status,
    signal: result.signal,
    durationMs: Date.now() - started,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  return result;
};

const version = mnemon(["--version"]);
if (version.status !== 0 || !String(version.stdout).includes("0.2.4")) {
  const manifest = finishEvidenceRun(run, "FAIL", "bundled mnemon --version is not 0.2.4");
  finish("FAIL", { command: "verify:bundled-runtime", reason: manifest.reason, dir: manifest.dir });
}
const remembered = mnemon(["remember", "bundled-penglai-memory", "--cat", "fact", "--source", "user"]);
if (remembered.status !== 0) {
  const manifest = finishEvidenceRun(run, "FAIL", "bundled mnemon remember failed");
  finish("FAIL", { command: "verify:bundled-runtime", reason: manifest.reason, dir: manifest.dir });
}
const found = mnemon(["search", "bundled-penglai-memory"]);
if (found.status !== 0 || !String(found.stdout).includes("bundled-penglai-memory")) {
  const manifest = finishEvidenceRun(run, "FAIL", "bundled mnemon search missed remember");
  finish("FAIL", { command: "verify:bundled-runtime", reason: manifest.reason, dir: manifest.dir });
}
const added = JSON.parse(remembered.stdout);
mnemon(["forget", added.id]);
const after = mnemon(["search", "bundled-penglai-memory"]);
if (String(after.stdout).includes(added.id)) {
  const manifest = finishEvidenceRun(run, "FAIL", "bundled mnemon forget did not remove the id");
  finish("FAIL", { command: "verify:bundled-runtime", reason: manifest.reason, dir: manifest.dir });
}

const engine = new MnemonMemoryService(mkdtempSync(join(tmpdir(), "penglai-bundled-engine-")), {
  appRoot: resources,
});
if (engine.degraded) {
  const manifest = finishEvidenceRun(run, "FAIL", engine.degradeReason ?? "bundled mnemon unresolved via appRoot");
  finish("FAIL", { command: "verify:bundled-runtime", reason: manifest.reason, dir: manifest.dir });
}
const row = await engine.remember({ text: "appRoot-resolved fact" });
const hits = await engine.search("appRoot-resolved", undefined, true);
if (!hits.some((hit) => hit.id === row.id)) {
  const manifest = finishEvidenceRun(run, "FAIL", "MnemonMemoryService did not recall via packaged appRoot");
  finish("FAIL", { command: "verify:bundled-runtime", reason: manifest.reason, dir: manifest.dir });
}
await engine.forget(row.id);
engine.close();

const layout = resolveRuntimeLayout(resources);
const officeUser = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-bundled-office-")));
ensurePrivateHome(officeUser);
activatePrivateProfile(layout, officeUser);
installFirstPartyPlugins(layout, officeUser.profileWeb, officeUser.transactions, ["@penglai/office"]);
const officeMod = await import(
  pathToFileURL(join(officeUser.profileWeb, "node_modules", "@penglai", "office", "dist", "index.js")).href
);
const workspace = mkdtempSync(join(tmpdir(), "penglai-bundled-ws-"));
const tools = new Map();
const ctx = {
  tools: {
    register(def) {
      if (!def?.output || typeof def.output.render !== "function") {
        throw new TypeError(`tool "${def.name}" must declare output { schema, render }`);
      }
      tools.set(def.name, def);
    },
  },
  workspaceRegistry: { list: () => [{ id: "ws-bundled", path: workspace, sessionIds: ["sess-bundled"] }] },
};
process.env.PENGLAI_USER_DATA = officeUser.root;
const owner = new OwnerApprovalBroker(officeUser.root, { dialog: async () => "approved" });
const svc = officeMod.createOfficeService({ userData: officeUser.root, owner });
officeMod.registerOfficeTools(ctx, svc);
const exec = { agent: { id: "sess-bundled" } };
const created = await tools.get("penglai_office_create").execute({ format: "pdf", text: "蓬莱办公中文" }, exec);
const planned = await tools.get("penglai_office_plan").execute({
  job_id: created.id,
  operation: { kind: "pdf.watermark", text: "preview" },
}, exec);
const preview = await tools.get("penglai_office_preview").execute({ job_id: planned.id }, exec);
if (!preview?.preview) {
  const manifest = finishEvidenceRun(run, "FAIL", "packed office preview missing");
  finish("FAIL", { command: "verify:bundled-runtime", reason: manifest.reason, dir: manifest.dir });
}
const committed = await tools.get("penglai_office_commit").execute({ job_id: planned.id, filename: "note.pdf" }, exec);
if (!String(committed?.dest ?? "").endsWith("note.pdf")) {
  const manifest = finishEvidenceRun(run, "FAIL", "packed office commit did not write workspace basename");
  finish("FAIL", { command: "verify:bundled-runtime", reason: manifest.reason, dir: manifest.dir });
}
const inspected = await svc.inspect(readFileSync(committed.dest));
if (!String(inspected.text ?? "").includes("蓬莱办公中文") && !String(inspected.text ?? "").includes("preview")) {
  const manifest = finishEvidenceRun(run, "FAIL", "packed office CJK/pdf inspect missed created text");
  finish("FAIL", { command: "verify:bundled-runtime", reason: manifest.reason, dir: manifest.dir });
}
await tools.get("penglai_office_undo").execute({ job_id: planned.id }, exec);

const failOpenUser = resolveUserLayout(mkdtempSync(join(tmpdir(), "penglai-bundled-failopen-")));
ensurePrivateHome(failOpenUser);
activatePrivateProfile(layout, failOpenUser);
installFirstPartyPlugins(layout, failOpenUser.profileWeb, failOpenUser.transactions, [
  "@penglai/office",
  "@penglai/memory",
]);
const emptyApp = mkdtempSync(join(tmpdir(), "penglai-empty-app-"));
mkdirSync(join(emptyApp, "mnemon"), { recursive: true });
const supervisor = new EmbeddedDshSupervisor(layout);
try {
  const started = await supervisor.start(failOpenUser, {
    PENGLAI_PLUGINS_DIR: layout.pluginsDir,
    PENGLAI_APP_ROOT: emptyApp,
  });
  const res = await fetch(`http://127.0.0.1:${started.port}/`);
  const body = await res.text();
  if (res.status !== 200 || !body.includes('id="root"')) {
    throw new Error(`DSH did not stay up without mnemon http=${res.status}`);
  }
} finally {
  await supervisor.stop().catch(() => undefined);
}

rmSync(dataDir, { recursive: true, force: true });
rmSync(officeUser.root, { recursive: true, force: true });
rmSync(failOpenUser.root, { recursive: true, force: true });
rmSync(emptyApp, { recursive: true, force: true });
rmSync(workspace, { recursive: true, force: true });

const manifest = finishEvidenceRun(run, "PASS", "bundled mnemon remember/search/forget, packed office tools, memory-missing DSH still HTTP 200", {
  mnemon: mnemonBin,
  sourceSha: packaged.release.sourceSha,
});
finish("PASS", {
  command: "verify:bundled-runtime",
  sourceSha: packaged.release.sourceSha,
  target: expectedTarget,
  dir: manifest.dir,
});
