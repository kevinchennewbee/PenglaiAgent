import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectStore } from "@penglai/contracts";
import { OwnerApprovalBroker } from "@penglai/runtime";
import { createOfficeService } from "./service.js";
import { registerOfficeTools } from "./tools.js";
import { atomicCommitFile, assertTrustedWorkspacePath } from "./transaction.js";
import { PENGLAI_CJK_FONT_LICENSE, PENGLAI_CJK_FONT_SHA256, loadPenglaiCjkFont } from "./cjk-font.js";

function liveOffice(userData: string, extra?: Parameters<typeof createOfficeService>[0]) {
  const owner = extra?.owner ?? new OwnerApprovalBroker(userData, { dialog: async () => "approved" });
  return createOfficeService({ userData, owner, ...extra });
}

function registered(names: string[]) {
  const tools = new Map<
    string,
    {
      execute: (args: unknown, exec?: unknown) => Promise<unknown>;
      output?: { schema?: unknown; render?: unknown };
    }
  >();
  const dir = mkdtempSync(join(tmpdir(), "penglai-office-ws-"));
  const ctx = {
    tools: {
      register(def: {
        name: string;
        execute: (args: unknown, exec?: unknown) => Promise<unknown>;
        output?: { schema?: unknown; render?: unknown };
      }) {
        if (
          def.output === undefined ||
          typeof def.output !== "object" ||
          typeof def.output.render !== "function"
        ) {
          throw new TypeError(`tool "${def.name}" must declare output { schema, render, presentationMeta? }`);
        }
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
  const svc = liveOffice(dir);
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
  assert.equal("bytes" in (planned as object), false);
  const committed = await tools.get("penglai_office_commit")?.execute({ job_id: jobId, filename: "note.docx" }, exec) as { dest: string };
  assert.match((await svc.inspect(readFileSync(committed.dest))).text, /revised-tools/);
  assert.equal(svc.job(jobId).receipt, undefined);
  await tools.get("penglai_office_undo")?.execute({ job_id: jobId }, exec);
  assert.equal(svc.job(jobId).receipt, undefined);
  await assert.rejects(
    () => tools.get("penglai_office_plan")?.execute({
      job_id: jobId,
      operation: { kind: "docx.replaceParagraph", text: "no-index" },
    }, exec),
    /paragraphIndex/,
  );
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

test("office return sends bytes only to the route captured on the attached handle", async () => {
  const userData = mkdtempSync(join(tmpdir(), "penglai-office-outbound-"));
  const objects = new ObjectStore(join(userData, "objects"));
  let delivered: {
    routeId: string;
    sessionId: string;
    workspaceId?: string;
    filename: string;
    bytes: Buffer;
    digest: string;
  } | undefined;
  const svc = liveOffice(userData, {
    objects,
    outbound: () => ({
      async sendFileToBoundRoute(input) {
        delivered = input;
        return { channel: "feishu", delivered: true };
      },
    }),
  });
  const created = await svc.create("docx", "route-bound-office");
  const { handle } = objects.put(created.bytes, { kind: "office", mime: "application/vnd.openxmlformats-officedocument" });
  objects.bind(handle, { sessionId: "sess-1", workspaceId: "ws-1", routeId: "route-feishu-1" });
  const attached = await svc.inspectAttached(handle, "sess-1");
  const receipt = await svc.approve(attached.id, "return-to-channel");
  const returned = await svc.returnToChannel(attached.id, receipt);
  assert.deepEqual(
    { routeId: delivered?.routeId, sessionId: delivered?.sessionId, workspaceId: delivered?.workspaceId },
    { routeId: "route-feishu-1", sessionId: "sess-1", workspaceId: "ws-1" },
  );
  assert.equal(delivered?.bytes.equals(created.bytes), true);
  assert.equal(returned.channel, "feishu");
  assert.equal(returned.delivered, true);

  const local = await svc.create("pdf", "local-only");
  await assert.rejects(() => svc.approve(local.id, "return-to-channel"), /no original IM route/);
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
  assert.ok(font.length > 10_000_000);
});
