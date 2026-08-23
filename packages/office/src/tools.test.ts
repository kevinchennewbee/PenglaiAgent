import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectStore } from "@penglai/contracts";
import { createOfficeService } from "./service.js";
import { registerOfficeTools } from "./tools.js";
import { atomicCommitFile, assertTrustedWorkspacePath } from "./transaction.js";
import { PENGLAI_CJK_FONT_LICENSE, PENGLAI_CJK_FONT_SHA256, loadPenglaiCjkFont } from "./cjk-font.js";

function registered(names: string[]) {
  const tools = new Map<string, { execute: (args: unknown, exec?: unknown) => Promise<unknown> }>();
  const dir = mkdtempSync(join(tmpdir(), "penglai-office-ws-"));
  const ctx = {
    tools: {
      register(def: { name: string; execute: (args: unknown, exec?: unknown) => Promise<unknown> }) {
        tools.set(def.name, def);
        names.push(def.name);
      },
    },
    workspaceRegistry: {
      list: () => [{ id: "ws1", path: dir, sessionIds: ["sess-1"] }],
    },
    asks: [] as string[],
    on(_event: string, listener: (exec: { name?: string }, next: () => Promise<{ kind: string }>) => Promise<{ kind: string }>) {
      void listener;
    },
  };
  return { tools, dir, ctx };
}

test("office conversation tools inspect, plan, preview, commit, undo without model paths", async () => {
  const names: string[] = [];
  const { tools, dir, ctx } = registered(names);
  const svc = createOfficeService();
  registerOfficeTools(ctx, svc);
  assert.equal(names.includes("penglai_office_inspect"), true);
  assert.equal(names.includes("penglai_office_commit"), true);
  const exec = { agent: { id: "sess-1" } };
  const created = await tools.get("penglai_office_create")?.execute({ format: "docx", text: "hello office tools" }, exec);
  const planned = await tools.get("penglai_office_plan")?.execute({
    job_id: (created as { id: string }).id,
    operation: { kind: "docx.replaceParagraph", paragraphIndex: 0, text: "revised-tools" },
  }, exec);
  const jobId = (planned as { id: string }).id;
  const preview = await tools.get("penglai_office_preview")?.execute({ job_id: jobId }, exec) as { preview: unknown; diff: unknown };
  assert.ok(preview.preview);
  await assert.rejects(
    () => tools.get("penglai_office_inspect")?.execute({ path: "/etc/passwd" }, exec),
    /path|SECURITY/i,
  );
  const committed = await tools.get("penglai_office_commit")?.execute({ job_id: jobId, filename: "note.docx" }, exec) as { dest: string };
  assert.match((await svc.inspect(readFileSync(committed.dest))).text, /revised-tools/);
  await tools.get("penglai_office_undo")?.execute({ job_id: jobId }, exec);
});

test("office attached handle is session-bound", async () => {
  const objects = new ObjectStore();
  const svc = createOfficeService({ objects });
  const created = await svc.create("docx", "attached-doc");
  const { handle } = objects.put(created.bytes, { kind: "office", mime: "application/vnd.openxmlformats-officedocument" });
  objects.bind(handle, { sessionId: "sess-1", workspaceId: "ws1" });
  const seen = await svc.inspectAttached(handle, "sess-1");
  assert.match(seen.text, /attached-doc/);
  await assert.rejects(() => svc.inspectAttached(handle, "sess-other"), /bound|UNAUTHORIZED/i);
});

test("atomic commit refuses parent symlink and destination symlink", () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-office-toctou-"));
  const outside = mkdtempSync(join(tmpdir(), "penglai-office-escape-"));
  const parentLink = join(root, "linked");
  symlinkSync(outside, parentLink);
  assert.throws(() => assertTrustedWorkspacePath(join(parentLink, "a.docx"), root), /symlink/i);
  const dest = join(root, "note.docx");
  writeFileSync(dest, "x");
  const destLink = join(root, "alias.docx");
  symlinkSync(dest, destLink);
  assert.throws(() => atomicCommitFile(destLink, Buffer.from("y"), join(root, "bak")), /symlink/i);
});

test("bundled CJK OFL font is hashed and embeddable", () => {
  const font = loadPenglaiCjkFont();
  assert.equal(PENGLAI_CJK_FONT_LICENSE, "OFL-1.1");
  assert.equal(PENGLAI_CJK_FONT_SHA256.length, 64);
  assert.ok(font.length > 1000);
});
