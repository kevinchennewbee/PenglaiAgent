import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactService } from "@penglai/artifacts";
import { ObjectStore } from "@penglai/contracts";
import { OwnerApprovalBroker } from "@penglai/runtime";
import { createOfficeService } from "./service.js";
import { registerOfficeTools } from "./tools.js";
import { atomicCommitFile, assertTrustedWorkspacePath, safeWorkspaceFilename } from "./transaction.js";
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

test("atomic commit refuses parent symlink and destination symlink", (t) => {
  const root = mkdtempSync(join(tmpdir(), "penglai-office-toctou-"));
  const outside = mkdtempSync(join(tmpdir(), "penglai-office-escape-"));
  const parentLink = join(root, "linked");
  try {
    symlinkSync(outside, parentLink);
  } catch (error) {
    if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("Windows account cannot create symlinks without Developer Mode or elevated privilege");
      return;
    }
    throw error;
  }
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


test("office job tools reject another Session and Workspace before reads or actions", async () => {
  const { tools, dir, ctx } = registered([]);
  ctx.workspaceRegistry.list = () => [
    { id: "ws1", path: dir, sessionIds: ["sess-1", "sess-2"] },
    { id: "ws2", path: dir, sessionIds: ["sess-3"] },
  ];
  let approvals = 0;
  const owner = new OwnerApprovalBroker(dir, { dialog: async () => { approvals++; return "approved"; } });
  const svc = liveOffice(dir, { owner });
  registerOfficeTools(ctx, svc);
  const created = await tools.get("penglai_office_create")!.execute(
    { format: "docx", text: "private session content" }, { agent: { id: "sess-1" } },
  ) as { id: string };
  for (const sessionId of ["sess-2", "sess-3"]) {
    for (const name of ["preview", "plan", "accept", "discard", "commit", "undo", "return_to_channel"]) {
      await assert.rejects(async () => tools.get(`penglai_office_${name}`)!.execute({
        job_id: created.id, filename: "stolen.docx",
        operation: { kind: "docx.replaceParagraph", paragraphIndex: 0, text: "overwritten" },
      }, { agent: { id: sessionId } }), /not bound to this Workspace and Session/);
    }
  }
  assert.equal(approvals, 0);
  assert.equal(svc.job(created.id).state, "INSPECTED");
  assert.match(svc.job(created.id).text, /private session content/);
  svc.cancel(created.id);
});

test("accepted office artifact can be saved with separate exact action approval and undone", async () => {
  const { tools, dir, ctx } = registered([]);
  const artifacts = new ArtifactService(join(dir, "artifacts"));
  let approvals = 0;
  const owner = new OwnerApprovalBroker(dir, { dialog: async () => { approvals++; return "approved"; } });
  const svc = liveOffice(dir, { owner, artifacts });
  registerOfficeTools(ctx, svc);
  const exec = { agent: { id: "sess-1" } };
  const filename = "项目 汇报.docx";
  const original = await svc.create("docx", "original content");
  writeFileSync(join(dir, filename), original.bytes);
  const inspected = await tools.get("penglai_office_inspect")!.execute({ filename }, exec) as { id: string };
  assert.equal(svc.job(inspected.id).sessionId, "sess-1");
  const planned = await tools.get("penglai_office_plan")!.execute({
    job_id: inspected.id, operation: { kind: "docx.replaceParagraph", paragraphIndex: 0, text: "accepted content" },
  }, exec) as { id: string };
  await tools.get("penglai_office_preview")!.execute({ job_id: planned.id }, exec);
  await tools.get("penglai_office_accept")!.execute({ job_id: planned.id }, exec);
  assert.equal(approvals, 0);
  assert.equal(svc.job(planned.id).state, "VERIFIED");
  await tools.get("penglai_office_commit")!.execute({ job_id: planned.id, filename }, exec);
  assert.equal(approvals, 1);
  assert.match((await svc.inspect(readFileSync(join(dir, filename)))).text, /accepted content/);
  await tools.get("penglai_office_undo")!.execute({ job_id: planned.id }, exec);
  assert.equal(approvals, 2);
  assert.deepEqual(readFileSync(join(dir, filename)), original.bytes);
  artifacts.close();
});


test("office Unicode filenames retain basename safety across supported platforms", () => {
  for (const name of ["项目 汇报.docx", "Quarterly report.xlsx", "résumé.pdf"]) assert.equal(safeWorkspaceFilename(name), name);
  for (const name of ["../report.docx", "folder/report.docx", "folder\\report.docx", "CON.docx", "report?.pdf", " report.pdf", "report\n.pdf"]) {
    assert.throws(() => safeWorkspaceFilename(name), /bounded workspace basename/);
  }
});
