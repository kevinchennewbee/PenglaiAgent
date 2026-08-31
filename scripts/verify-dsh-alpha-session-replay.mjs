#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const EXPECTED_ALPHA_SHA = "0a53fb55bea101816fa226bb964ae2bed71c343b";
const RC2_TAG = "dsh-v0.1.1-rc.2";

function fail(message) {
  process.stderr.write(`DSH_ALPHA_SESSION_REPLAY_FAIL ${message}\n`);
  process.exit(1);
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function knownEvents(source) {
  const start = source.indexOf("new Set([\n");
  const end = source.indexOf("\n])", start);
  if (start === -1 || end === -1)
    fail("known event catalog is not recognizable");
  return new Set(
    [...source.slice(start, end).matchAll(/'([^']+)',/g)].map(
      (match) => match[1],
    ),
  );
}

const checkoutArg = process.argv[2] ?? process.env.PENGLAI_DSH_ALPHA_SOURCE;
if (!checkoutArg) fail("pass the fixed alpha source checkout path");
const checkout = resolve(checkoutArg);
if (!existsSync(join(checkout, "pnpm-lock.yaml")))
  fail("source checkout is missing pnpm-lock.yaml");
if (git(checkout, ["rev-parse", "HEAD"]) !== EXPECTED_ALPHA_SHA)
  fail("source checkout HEAD drifted");
if (git(checkout, ["status", "--porcelain"])) fail("source checkout is dirty");

const catalogPath = "packages/core/session/src/known-event-types.ts";
const rc2Catalog = git(checkout, ["show", `${RC2_TAG}:${catalogPath}`]);
const alphaCatalog = readFileSync(join(checkout, catalogPath), "utf8");
const rc2Events = knownEvents(rc2Catalog);
const alphaEvents = knownEvents(alphaCatalog);
const missingEvents = [...rc2Events]
  .filter((event) => !alphaEvents.has(event))
  .sort();
assert.deepEqual(
  missingEvents,
  [],
  `alpha known-event catalog dropped rc.2 events: ${missingEvents.join(", ")}`,
);

const replay = String.raw`
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import SessionStore, { SessionId } from "@deepseek-ai/dsh-session";
import JsonlSessionPersistence from "@deepseek-ai/dsh-session-persistence-jsonl";

void (async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-rc2-alpha-replay-"));
  const ctx = new Context();
  const sessionFiber = await ctx.plugin(SessionStore);
  const persistenceFiber = await ctx.plugin(JsonlSessionPersistence, {
    root,
    compression: "none",
    writeBatchMaxDelayMs: 1,
  });
  try {
    const id = SessionId("penglai-privacy-safe-rc2");
    const meta = {
      version: 0,
      id,
      createdAt: 1,
      cwd: "/privacy-safe-workspace",
    };
    const path = ctx.sessionPersistence.locate(meta).path;
    const rows = [
      {
        type: "session",
        version: 0,
        id,
        createdAt: 1,
        cwd: "/privacy-safe-workspace",
        delegationDepth: 0,
      },
      { type: "turn/start", seq: 0, time: 2, data: { turn: 1 } },
      {
        type: "user/message",
        seq: 1,
        time: 3,
        data: { content: [{ type: "text", text: "privacy-safe rc.2 replay" }], source: { kind: "user" } },
        surfaceOp: "append",
      },
      {
        type: "todo/write",
        seq: 2,
        time: 4,
        data: { todos: [{ content: "verify upgrade", status: "completed" }] },
      },
      { type: "turn/end", seq: 3, time: 5, data: { turn: 1, reason: { kind: "completed" } } },
    ];
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 });

    const inspected = await ctx.sessionPersistence.inspect(id);
    const loaded = await ctx.sessionPersistence.load(id);
    for (const snapshot of [inspected, loaded]) {
      assert.equal(snapshot.meta.version, 0);
      assert.equal(snapshot.events.length, 4);
      assert.equal(snapshot.events.some((event) => event.type === "todo/write"), true);
      const user = snapshot.events.find((event) => event.type === "user/message");
      assert.equal(user?.type, "user/message");
      assert.match(user?.data.id ?? "", /^legacy-message:penglai-privacy-safe-rc2:/);
    }
    process.stdout.write(JSON.stringify({ replay: "PASS", events: loaded.events.length }) + "\n");
  } finally {
    await persistenceFiber.dispose();
    await sessionFiber.dispose();
    rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  process.stderr.write(String(error?.stack ?? error) + "\n");
  process.exitCode = 1;
});
`;

const tsx = join(
  checkout,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);
if (!existsSync(tsx)) fail("run the fixed source frozen-lock install first");
const result = spawnSync(tsx, ["--eval", replay], {
  cwd: checkout,
  encoding: "utf8",
  env: { ...process.env, NO_COLOR: "1" },
});
if (result.status !== 0) {
  process.stderr.write(
    result.stderr || result.stdout || "alpha replay process failed\n",
  );
  process.exit(result.status ?? 1);
}
const proof = JSON.parse(result.stdout.trim());
assert.deepEqual(proof, { replay: "PASS", events: 4 });
process.stdout.write(
  `${JSON.stringify({
    status: "PASS",
    alphaSha: EXPECTED_ALPHA_SHA,
    rc2KnownEvents: rc2Events.size,
    alphaKnownEvents: alphaEvents.size,
    missingRc2Events: 0,
    replayedEvents: proof.events,
  })}\n`,
);
