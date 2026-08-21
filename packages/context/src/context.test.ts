import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ContextIndex, apply, assertGrant, consumeContextGrantCapability, ftsLiteral, hostSourceStatus, revokeDerived } from "./index.js";
import { createContextSettingsApi } from "./remote.js";

test("Context grants require realpath and never delete the source", () => {
  assert.throws(
    () => assertGrant({ scope: "global", requestedPath: "/tmp/a", realPath: "/tmp/b" }),
    /realpath/,
  );
  assert.throws(
    () => assertGrant({ scope: "global", requestedPath: "/tmp/../.ssh", realPath: "/tmp/../.ssh" }),
    /escape/,
  );
  assert.doesNotThrow(() => assertGrant({ scope: "workspace", workspaceId: "w1", requestedPath: "/data/notes", realPath: "/data/notes" }));
  assert.equal(hostSourceStatus({ granted: true, exists: true, digest: "aa", indexedDigest: "bb" }), "stale");
  assert.equal(hostSourceStatus({ granted: false, exists: true, digest: "aa", indexedDigest: "aa" }), "revoked");
  assert.deepEqual(revokeDerived(true), { deletedDerived: true, sourceUntouched: true });
});

test("Context FTS5 indexes only granted paths and revoke drops derived rows", () => {
  const idx = new ContextIndex(":memory:");
  assert.throws(() => idx.indexText("/data/notes", "hello penglai", "aa"), /grant/);
  idx.putGrant("/data/notes", "aa");
  idx.indexText("/data/notes", "hello penglai", "aa");
  assert.equal(idx.search("penglai")[0]?.path, "/data/notes");
  assert.equal(idx.card("/data/notes", "bb", true), "stale");
  assert.deepEqual(idx.revoke("/data/notes"), { deletedDerived: true, sourceUntouched: true });
  assert.equal(idx.search("penglai").length, 0);
});

test("Context FTS queries are quoted literals and grant roots cannot wildcard", () => {
  const idx = new ContextIndex(":memory:");
  // FTS5 operators are inert inside quotes.
  assert.equal(ftsLiteral('hello OR world'), '"hello" "OR" "world"');
  assert.equal(ftsLiteral('penglai*'), '"penglai*"');
  assert.throws(() => ftsLiteral("   "), /query required/);
  // A grant root containing '%' must not wildcard-match a sibling path.
  idx.putGrant("/data/50%/notes", "aa");
  idx.indexText("/data/50%/notes", "penglai root percent", "aa");
  assert.throws(() => idx.read("/data/50x/notes"), /grant|UNAUTHORIZED/);
  idx.close();
});

test("Context ingest rejects a symlink escaping the grant root", async () => {
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { realpathSync } = await import("node:fs");
  const { createContextService } = await import("./index.js");
  const base = realpathSync(mkdtempSync(join(tmpdir(), "penglai-ctx-link-")));
  const grantRoot = join(base, "granted");
  const outside = join(base, "outside");
  mkdirSync(grantRoot);
  mkdirSync(outside);
  writeFileSync(join(grantRoot, "inside.md"), "inside grant root");
  writeFileSync(join(outside, "secret.md"), "this must never be indexed");
  symlinkSync(join(outside, "secret.md"), join(grantRoot, "leak.md"));
  try {
    const svc = createContextService(join(base, "index.sqlite"));
    const report = svc.ingest({ scope: "global", requestedPath: grantRoot, realPath: grantRoot });
    assert.equal(report.indexed, 1, "only the real inside file is indexed, not the symlink target");
    assert.equal(svc.search("inside")[0]?.path, join(grantRoot, "inside.md"));
    assert.equal(svc.search("never").length, 0);
    svc.close();
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("R50-CTXMEM: ingest walks a granted directory and never rewrites source", async () => {
  const { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { realpathSync } = await import("node:fs");
  const { createContextService } = await import("./index.js");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "penglai-ctx-")));
  mkdirSync(join(root, "notes"));
  const note = join(root, "notes", "readme.md");
  writeFileSync(note, "Penglai indexes this markdown locally.");
  const before = readFileSync(note);
  const svc = createContextService(join(root, "index.sqlite"));
  const report = svc.ingest({ scope: "global", requestedPath: root, realPath: root });
  assert.equal(report.indexed >= 1, true);
  assert.equal(svc.search("Penglai")[0]?.path, note);
  assert.equal(Buffer.compare(before, readFileSync(note)), 0);
  assert.deepEqual(svc.revokeRoot(root), { deletedDerived: true, sourceUntouched: true });
  assert.equal(svc.search("Penglai").length, 0);
  assert.equal(Buffer.compare(before, readFileSync(note)), 0);
  rmSync(root, { recursive: true, force: true });
});

test("R50-CTXMEM-001/005/015 production apply uses durable userData, typed Cordis service, and official tools", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "penglai-ctx-apply-"));
  const previous = process.env.PENGLAI_USER_DATA;
  process.env.PENGLAI_USER_DATA = root;
  const tools: Array<Record<string, unknown>> = [];
  let provided: unknown;
  let dispose: (() => void) | undefined;
  try {
    const service = apply({
      tools: { register: (definition) => tools.push(definition) },
      workspaceRegistry: { list: () => [] },
      provide: (serviceName, value) => {
        assert.equal(serviceName, "penglaiContext");
        provided = value;
      },
      effect: (setup) => {
        dispose = setup();
      },
    });
    assert.equal(provided, service);
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["penglai_context_search", "penglai_context_read"],
    );
    assert.equal((tools[0]?.description as string).includes("untrusted"), true);
    dispose?.();
    assert.equal((await import("node:fs")).existsSync(join(root, "context", "context.sqlite3")), true);
  } finally {
    if (previous === undefined) delete process.env.PENGLAI_USER_DATA;
    else process.env.PENGLAI_USER_DATA = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Context settings consumes one opaque picker capability and exposes no raw-path grant API", async () => {
  const { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createContextGrantReceipt } = await import("../../../apps/desktop/src/context-grant.js");
  const { createContextService } = await import("./index.js");
  const userData = mkdtempSync(join(tmpdir(), "penglai-context-cap-"));
  const source = join(userData, "source");
  mkdirSync(source);
  writeFileSync(join(source, "note.md"), "opaque Penglai source");
  try {
    const receipt = createContextGrantReceipt(userData, source, 1_000);
    const resolved = consumeContextGrantCapability(userData, receipt.capabilityRef, 2_000);
    assert.equal(resolved, realpathSync(source));
    assert.throws(() => consumeContextGrantCapability(userData, receipt.capabilityRef, 2_000), /missing|used/);

    const next = createContextGrantReceipt(userData, source);
    const service = createContextService(join(userData, "index.sqlite3"));
    const api = createContextSettingsApi(service, userData, { list: () => [{ id: "w1", title: "Workspace" }] });
    assert.equal(api.ingestCapability({ capabilityRef: next.capabilityRef, scope: "workspace", workspaceId: "w1" }).indexed, 1);
    assert.equal(api.status().grants[0]?.documents, 1);
    assert.deepEqual(api.revoke({ root: realpathSync(source), ownerConfirmed: true }), {
      deletedDerived: true,
      sourceUntouched: true,
    });
    assert.equal("ingestPath" in api, false);
    service.close();
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

test("Context client registers a real official settings tab", () => {
  const source = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  assert.match(source, /settings\.section/);
  assert.match(source, /data-penglai-context/);
  assert.match(source, /penglaiContextSettings/);
  assert.match(source, /pickContextFolder/);
  assert.doesNotMatch(source, /type: "text"[^\n]+requestedPath/);
});

test("P51-AUTH-001 model workspace_id cannot choose another Workspace", async () => {
  const { boundWorkspaceId } = await import("./index.js");
  const ctx = {
    workspaceRegistry: {
      list: () => [
        { id: "ws-current", sessionIds: ["sess-1"] },
        { id: "ws-other", sessionIds: ["sess-2"] },
      ],
    },
  };
  assert.equal(boundWorkspaceId(ctx, { agent: { id: "sess-1" } }), "ws-current");
  assert.equal(boundWorkspaceId(ctx, { agent: { id: "sess-2" } }), "ws-other");
  assert.throws(() => boundWorkspaceId(ctx, {}), /exec.agent.id/);
  assert.throws(() => boundWorkspaceId(ctx, { sessionId: "sess-1" }), /exec.agent.id/);
  assert.throws(() => boundWorkspaceId(ctx, { agent: { id: "forged" } }), /not bound/);
});

test("production Context apply refuses an in-memory fallback", () => {
  const previous = process.env.PENGLAI_USER_DATA;
  delete process.env.PENGLAI_USER_DATA;
  try {
    assert.throws(() => apply({ tools: { register() {} }, provide() {} }), /PENGLAI_USER_DATA/);
  } finally {
    if (previous !== undefined) process.env.PENGLAI_USER_DATA = previous;
  }
});
