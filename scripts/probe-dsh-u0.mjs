#!/usr/bin/env node
// Historical U0 reconnaissance only. This 0.1.0-rc.7 compatibility probe is
// intentionally not an active 0.5.8 package script; current alpha.1 verification
// is owned by the source-closure, bridge-contract, runner-live and native gates.
// Original scope: npm dist-tags, installed rc.6 API surfaces, in-process
// official credentials/llm, wire-format inspection, and live embedded DSH
// /api + events.host. Writes evidence/generated/dsh-u0-runtime.json.
// The committed archive is docs/compatibility/DSH_010_RC7_U0.md.
// Does not change product pins.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, gitState } from "./lib/repo.mjs";

const require = createRequire(join(ROOT, "packages/dsh-bridge/package.json"));
const ISSUE3_OVERLAY_SHA = {
  "dsh-client-ui-settings-models/lib/client.js":
    "92b93c91601fa8b787b62a431c82e41dc046d768b31866370aae55b959114894",
  "dsh-client-ui-sidebar/lib/client.js":
    "b9bd53c300a07199cadcfee7c2a35c6ca4633849ce14574738c26649b09657ba",
  "dsh-web-frontend/dist/index.html":
    "dd159dc02803ac2b16892ec5843567722e0b18e93a9a7a888c77410ea108a13e",
};

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function npmView(name, fields) {
  const out = execFileSync("npm", ["view", name, ...fields, "--json"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  return JSON.parse(out);
}

function extractSnippet(text, needle, radius = 240) {
  const i = text.indexOf(needle);
  if (i < 0) return null;
  return text.slice(Math.max(0, i - 40), i + radius);
}

function record(step, ok, detail) {
  return { step, ok, ...detail };
}

const git = gitState();
const report = {
  probe: "dsh-u0-runtime",
  generatedAt: new Date().toISOString(),
  sourceSha: git.head,
  originMain: git.originMain,
  dirty: git.dirty,
  installedPin: "0.1.0-rc.7",
  steps: [],
};

const PACKAGES = [
  "@deepseek-ai/dsh",
  "@deepseek-ai/dsh-web-frontend",
  "@deepseek-ai/dsh-cordis-client-runner",
  "@deepseek-ai/dsh-typert-protocol",
  "@deepseek-ai/dsh-agent",
  "@deepseek-ai/dsh-credentials-local",
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-ui-settings-models",
  "@deepseek-ai/dsh-client-ui-sidebar",
  "@deepseek-ai/dsh-llm",
  "@deepseek-ai/dsh-workspace",
  "@deepseek-ai/dsh-credentials",
];

const distTags = {};
let rc8Seen = false;
for (const name of PACKAGES) {
  const tags = npmView(name, ["dist-tags"]);
  distTags[name] = tags;
  const values = Object.values(tags ?? {});
  if (values.some((v) => String(v).includes("rc.8"))) rc8Seen = true;
}
report.distTags = distTags;
report.steps.push(
  record("npm-dist-tags", !rc8Seen, {
    latestDsh: distTags["@deepseek-ai/dsh"]?.latest,
    nextDsh: distTags["@deepseek-ai/dsh"]?.next,
    rc8Seen,
  }),
);
if (rc8Seen) {
  console.error("U0 STOP: rc.8 exists; Issue 3 requires a new package-by-package diff before pinning");
  writeOutputs(report);
  process.exit(2);
}

const ZERO_DIFF = [
  "@deepseek-ai/dsh-typert-protocol",
  "@deepseek-ai/dsh-agent",
  "@deepseek-ai/dsh-credentials-local",
  "@deepseek-ai/dsh-client-connection",
];
const installed = {};
for (const name of ZERO_DIFF) {
  const pkg = require(`${name}/package.json`);
  installed[name] = { version: pkg.version, main: pkg.main };
}
report.installedZeroDiff = installed;
report.steps.push(
  record(
    "installed-zero-diff-versions",
    ZERO_DIFF.every((name) => installed[name].version === "0.1.0-rc.7"),
    { installed },
  ),
);

const typert = require("@deepseek-ai/dsh-typert-protocol");
report.steps.push(
  record("typert-protocol-exports", typeof typert.TypertRemoteService === "function" && typeof typert.Remote === "function", {
    hasTypertRemoteService: typeof typert.TypertRemoteService === "function",
    hasRemote: typeof typert.Remote === "function",
    hasIsTypertRemoteSegment: typeof typert.isTypertRemoteSegment === "function",
  }),
);

const agent = require("@deepseek-ai/dsh-agent");
report.steps.push(
  record("dsh-agent-exports", typeof agent.AgentRegistry === "function", {
    hasAgentRegistry: typeof agent.AgentRegistry === "function",
    hasCreateOnPrototype: typeof agent.AgentRegistry?.prototype?.create === "function",
  }),
);

const credLocal = require("@deepseek-ai/dsh-credentials-local");
const LocalCredentialProvider = credLocal.default ?? credLocal.LocalCredentialProvider;
report.steps.push(
  record("credentials-local-exports", typeof LocalCredentialProvider === "function", {
    hasDefault: typeof credLocal.default === "function",
    hasNamed: typeof credLocal.LocalCredentialProvider === "function",
    filename: credLocal.CREDENTIALS_FILENAME,
  }),
);

const connClientPath = require.resolve("@deepseek-ai/dsh-client-connection/client");
const connText = readFileSync(connClientPath, "utf8");
const wire = {
  hasCreateWebConnectionRpc: connText.includes("createWebConnectionRpc"),
  hasClientRequest: connText.includes('type: "client-request"'),
  hasServerResponse: connText.includes("serverResponse"),
  hasEventsHost: connText.includes("events.host"),
  snippet: extractSnippet(connText, "createWebConnectionRpc"),
};
report.wireFormat = wire;
report.steps.push(
  record(
    "client-connection-wire-format",
    wire.hasCreateWebConnectionRpc && wire.hasClientRequest && wire.hasEventsHost,
    wire,
  ),
);

const apiproxyRoot = join(
  ROOT,
  "node_modules/@deepseek-ai/dsh-host-apiproxy",
);
const handlerPath = join(apiproxyRoot, "lib/types/fetch/handler.js");
const handlerText = readFileSync(handlerPath, "utf8");
report.steps.push(
  record(
    "apiproxy-events-host-sse",
    handlerText.includes("path === '/api/events.host'") &&
      handlerText.includes("text/event-stream") &&
      handlerText.includes("client-request"),
    {
      eventsHostGet: handlerText.includes("path === '/api/events.host' && req.method === 'GET'"),
      sseHeader: handlerText.includes("text/event-stream"),
    },
  ),
);

const overlayTmp = mkdtempSync(join(tmpdir(), "penglai-u0-rc7-"));
const overlayHashes = {};
try {
  const targets = [
    {
      pkg: "@deepseek-ai/dsh-client-ui-settings-models",
      file: "lib/client.js",
      key: "dsh-client-ui-settings-models/lib/client.js",
    },
    {
      pkg: "@deepseek-ai/dsh-client-ui-sidebar",
      file: "lib/client.js",
      key: "dsh-client-ui-sidebar/lib/client.js",
    },
    {
      pkg: "@deepseek-ai/dsh-web-frontend",
      file: "dist/index.html",
      key: "dsh-web-frontend/dist/index.html",
    },
  ];
  for (const target of targets) {
    const packed = execFileSync("npm", ["pack", `${target.pkg}@0.1.0-rc.7`, "--pack-destination", overlayTmp], {
      encoding: "utf8",
      cwd: overlayTmp,
    }).trim().split("\n").at(-1);
    const tgz = join(overlayTmp, packed);
    const extractDir = join(overlayTmp, target.pkg.replace("@", "").replace("/", "-"));
    mkdirSync(extractDir, { recursive: true });
    execFileSync("tar", ["-xzf", tgz, "-C", extractDir], { cwd: overlayTmp });
    const body = readFileSync(join(extractDir, "package", target.file));
    const digest = sha256(body);
    overlayHashes[target.key] = {
      sha256: digest,
      matchesIssue3: digest === ISSUE3_OVERLAY_SHA[target.key],
    };
  }
  report.rc7OverlayHashes = overlayHashes;
  report.steps.push(
    record(
      "rc7-overlay-sha-replay",
      Object.values(overlayHashes).every((row) => row.matchesIssue3),
      overlayHashes,
    ),
  );
} catch (err) {
  report.steps.push(
    record("rc7-overlay-sha-replay", false, { error: String(err).slice(0, 400) }),
  );
}

const { Context } = await import("@deepseek-ai/cordis");
const { LlmRuntime } = await import("@deepseek-ai/dsh-llm");
const llmCtx = new Context();
const llm = new LlmRuntime(llmCtx);
const providers = llm.listProviders();
let listModelsError = null;
let resolveError = null;
try {
  await llm.listModels("deepseek");
} catch (err) {
  listModelsError = err instanceof Error ? err.name : typeof err;
}
try {
  await llm.resolveModelInfo("deepseek", "deepseek-chat");
} catch (err) {
  resolveError = err instanceof Error ? err.name : typeof err;
}
report.steps.push(
  record("llm-runtime-methods", typeof llm.listProviders === "function" && typeof llm.listModels === "function" && typeof llm.resolveModelInfo === "function", {
    listProvidersReturnsArray: Array.isArray(providers),
    providerCount: providers.length,
    listModelsCallable: true,
    resolveModelInfoCallable: true,
    listModelsWithoutAdapter: listModelsError,
    resolveWithoutAdapter: resolveError,
  }),
);

const credHome = mkdtempSync(join(tmpdir(), "penglai-u0-cred-"));
try {
  const credCtx = new Context();
  const fiber = credCtx.plugin(LocalCredentialProvider, {
    dshHome: credHome,
    watch: false,
  });
  await fiber.await();
  const creds = credCtx.credentials;
  if (!creds?.set || !creds.describe) {
    throw new Error("ctx.credentials missing after LocalCredentialProvider plugin");
  }
  const ref = "U0_PROBE_API_KEY";
  await creds.set(ref, "u0-probe-not-a-real-key");
  const described = await creds.describe(ref);
  const resolved = await creds.resolve(ref);
  if (described && "value" in described && described.value !== undefined) {
    throw new Error("describe leaked value");
  }
  if (!described.configured || described.writable !== true) {
    throw new Error(`describe unexpected ${JSON.stringify(described)}`);
  }
  if (!resolved?.value) throw new Error("resolve missing value");
  await creds.unset(ref);
  const after = await creds.describe(ref);
  report.steps.push(
    record("credentials-local-set-describe", after.configured === false, {
      configuredAfterSet: described.configured,
      source: described.source,
      writable: described.writable,
      describeHasValue: false,
      unsetClears: after.configured === false,
    }),
  );
  await fiber.dispose();
} catch (err) {
  report.steps.push(
    record("credentials-local-set-describe", false, { error: String(err).slice(0, 800) }),
  );
} finally {
  rmSync(credHome, { recursive: true, force: true });
}

const dshBin = require.resolve("@deepseek-ai/dsh/lib/bin.js");
const dumpHome = mkdtempSync(join(tmpdir(), "penglai-u0-dsh-home-"));
const dump = spawnSync(process.execPath, [dshBin, "--profile", "web", "--dump-default-config"], {
  encoding: "utf8",
  env: { ...process.env, DSH_HOME: dumpHome },
});
const dumpOk =
  dump.status === 0 &&
  dump.stdout.includes("dsh-credentials-local") &&
  (dump.stdout.includes("dsh-host-plugin-inventory") || dump.stdout.includes("plugin-inventory"));
report.steps.push(
  record("dump-default-config", dumpOk, {
    exitCode: dump.status,
    hasCredentialsLocal: dump.stdout.includes("dsh-credentials-local"),
    hasInventory:
      dump.stdout.includes("dsh-host-plugin-inventory") || dump.stdout.includes("plugin-inventory"),
    hasOnboarding:
      dump.stdout.includes("settings.onboarding") || dump.stdout.includes("dsh-client-ui-settings-general"),
    stderr: dump.stderr.slice(0, 400),
  }),
);
rmSync(dumpHome, { recursive: true, force: true });

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr !== "string" ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

async function waitHttp(url, timeoutMs) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return res;
      last = `status ${res.status}`;
    } catch (err) {
      last = String(err);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`HTTP wait failed ${url}: ${last}`);
}

async function officialRpc(port, method, payload) {
  const rpcId = randomUUID();
  const res = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-request",
      rpcId,
      method,
      payload,
    }),
  });
  const json = await res.json().catch(() => null);
  return { rpcId, status: res.status, json };
}

try {
  const liveHome = mkdtempSync(join(tmpdir(), "penglai-u0-live-"));
  const workDir = mkdtempSync(join(tmpdir(), "penglai-u0-ws-"));
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [dshBin, "--profile", "web", "--no-open", "--host", "127.0.0.1", "--port", String(port)],
    {
      env: { ...process.env, DSH_HOME: liveHome, HOME: liveHome },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  child.stdout?.on("data", (d) => {
    logs += String(d);
  });
  child.stderr?.on("data", (d) => {
    logs += String(d);
  });
  try {
    const rootRes = await waitHttp(`http://127.0.0.1:${port}/`, 25_000);
    const rootBody = await rootRes.text();
    const providers = await officialRpc(port, "llm.providers", {});
    const models = await officialRpc(port, "llm.models", {});
    const setCred = await officialRpc(port, "credentials.set", {
      ref: "U0_PROBE_API_KEY",
      value: "u0-probe-not-a-real-key",
    });
    const describe = await officialRpc(port, "credentials.describe", {
      refs: ["U0_PROBE_API_KEY"],
    });
    const describeValue = describe.json?.result?.value?.credentials?.U0_PROBE_API_KEY;
    const wsCreate = await officialRpc(port, "workspace.create", { path: workDir });
    const wsList = await officialRpc(port, "workspace.list", {});
    const workspaceId = wsCreate.json?.result?.value?.workspace?.workspaceId;
    const listed = wsList.json?.result?.value?.items ?? [];
    const session = await officialRpc(port, "session.create", {
      ...(workspaceId ? { workspaceId } : { cwd: workDir }),
    });
    const sessionId = session.json?.result?.value?.sessionId;
    const plainEvents = await fetch(`http://127.0.0.1:${port}/api/events.host`);
    const plainEventsStatus = plainEvents.status;
    const plainEventsBody = (await plainEvents.text()).slice(0, 80);
    const liveOk =
      rootRes.status === 200 &&
      plainEventsStatus === 426 &&
      providers.status === 200 &&
      providers.json?.type === "server-response" &&
      Array.isArray(providers.json?.result?.value?.providers) &&
      models.status === 200 &&
      setCred.json?.result?.ok === true &&
      describeValue?.configured === true &&
      !("value" in (describeValue ?? {})) &&
      wsCreate.json?.result?.ok === true &&
      typeof workspaceId === "string" &&
      listed.some((row) => row.workspaceId === workspaceId) &&
      typeof sessionId === "string" &&
      sessionId.length > 0;
    report.liveDsh = {
      port,
      http: rootRes.status,
      hasHtml: rootBody.includes("<html") || rootBody.includes("<!DOCTYPE"),
      eventsHostPlain: plainEventsStatus,
      eventsHostPlainBody: plainEventsBody,
      eventsHostRequiresUpgrade: plainEventsStatus === 426,
      apiproxySseContract: true,
      llmProviderCount: providers.json?.result?.value?.providers?.length ?? 0,
      llmHasDeepseekOfficial: (providers.json?.result?.value?.providers ?? []).some(
        (p) => p.provider === "deepseek-official",
      ),
      llmModelsOk: models.json?.result?.ok === true,
      credentialSetOk: setCred.json?.result?.ok === true,
      credentialDescribed: describeValue,
      workspaceCreateOk: wsCreate.json?.result?.ok === true,
      workspaceId: workspaceId ?? null,
      workspaceListContainsCreated: listed.some((row) => row.workspaceId === workspaceId),
      sessionCreateOk: session.json?.result?.ok === true,
      sessionId: sessionId ?? null,
    };
    report.steps.push(record("live-dsh-http-sse-rpc", liveOk, report.liveDsh));
  } catch (err) {
    report.steps.push(
      record("live-dsh-http-sse-rpc", false, {
        error: String(err).slice(0, 1200),
        logs: logs.slice(-800),
      }),
    );
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (!child.killed) child.kill("SIGKILL");
    rmSync(liveHome, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
} catch (err) {
  report.steps.push(
    record("live-dsh-http-sse-rpc", false, { error: String(err).slice(0, 1200) }),
  );
}

const failed = report.steps.filter((s) => !s.ok);
report.verdict = failed.length === 0 ? "PASS" : "FAIL";
report.failedSteps = failed.map((s) => s.step);
writeOutputs(report);
if (failed.length) {
  console.error("U0 probe FAIL", report.failedSteps);
  process.exit(1);
}
console.log(JSON.stringify({ probe: "dsh-u0-runtime", verdict: "PASS", steps: report.steps.map((s) => s.step) }, null, 2));

function writeOutputs(data) {
  const evDir = join(ROOT, "evidence/generated");
  mkdirSync(evDir, { recursive: true });
  writeFileSync(join(evDir, "dsh-u0-runtime.json"), `${JSON.stringify(data, null, 2)}\n`);
}
