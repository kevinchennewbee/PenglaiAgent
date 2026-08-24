import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ArtifactService } from "@penglai/artifacts";
import { OwnerApprovalBroker } from "@penglai/runtime";
import { apply, createOfficeService } from "./index.js";

test("office production apply wires broker and artifacts and refuses HMAC self-receipts", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(pkg.dependencies["@penglai/artifacts"], "workspace:*");
  assert.equal(pkg.dependencies["@penglai/runtime"], "workspace:*");
  const applySource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(applySource, /new OwnerApprovalBroker/);
  assert.match(applySource, /new ArtifactService/);
  assert.match(applySource, /createHostOwnerDialog/);
  const serviceSource = readFileSync(new URL("./service.ts", import.meta.url), "utf8");
  assert.match(serviceSource, /office broker receipt required/);
  assert.doesNotMatch(serviceSource, /verifyOfficeReceipt/);
  assert.doesNotMatch(serviceSource, /issueOfficeReceipt/);

  const root = mkdtempSync(join(tmpdir(), "penglai-office-apply-"));
  const previous = process.env.PENGLAI_USER_DATA;
  process.env.PENGLAI_USER_DATA = root;
  try {
    const provided: unknown[] = [];
    const svc = apply({
      provide(_name, value) {
        provided.push(value);
      },
      workspaceRegistry: { list: () => [{ id: "ws-a", path: root, sessionIds: ["sess-1"] }] },
      tools: { register() { return undefined; } },
    });
    const created = await svc.create("docx", "broker-required");
    assert.throws(() => svc.commit(created.id, "owner-1"), /broker receipt|broker is not configured/);
    assert.equal(provided.length >= 1, true);
  } finally {
    if (previous === undefined) delete process.env.PENGLAI_USER_DATA;
    else process.env.PENGLAI_USER_DATA = previous;
  }
});

test("office commit consumes a Main broker receipt once and deny has no write", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-office-prod-"));
  const userData = join(root, "user-data");
  const denied = new OwnerApprovalBroker(userData, { dialog: async () => "denied" });
  const closed = createOfficeService({ userData, owner: denied });
  const created = await closed.create("docx", "must-not-write");
  await closed.preview(created.id);
  await assert.rejects(() => closed.approve(created.id, "commit"), /denied/);
  assert.throws(() => closed.commit(created.id, "aaaa.bbbb"), /broker receipt/);

  const owner = new OwnerApprovalBroker(userData, { dialog: async () => "approved" });
  const svc = createOfficeService({ userData, owner });
  const job = await svc.create("docx", "broker-write");
  await svc.preview(job.id);
  const receipt = await svc.approve(job.id, "commit");
  assert.ok(svc.commit(job.id, receipt).length > 0);
  assert.throws(() => svc.commit(job.id, receipt), /REPLAY|STATE|broker/);
});

test("office workspace intake stores an ArtifactRef and refuses cross-workspace reads", async () => {
  const root = mkdtempSync(join(tmpdir(), "penglai-office-artifact-"));
  const userData = join(root, "user-data");
  const artifacts = new ArtifactService(join(userData, "artifacts"));
  const owner = new OwnerApprovalBroker(userData, { dialog: async () => "approved" });
  const svc = createOfficeService({ userData, owner, artifacts });
  const created = await svc.create("docx", "artifact-bound-office");
  const dest = join(root, "note.docx");
  writeFileSync(dest, created.bytes);
  const inspected = await svc.inspectWorkspaceFile(dest, root, "ws-a");
  const job = svc.job(inspected.id);
  assert.match(String(job.artifactId), /^sha256:[0-9a-f]{64}$/);
  const ref = artifacts.ref(job.artifactId!);
  assert.equal(JSON.stringify(ref).includes(root), false);
  assert.throws(() => artifacts.readControlled(job.artifactId!, { workspaceId: "ws-b" }), /WORKSPACE/);
  assert.equal(artifacts.readControlled(job.artifactId!, { workspaceId: "ws-a" }).bytes.equals(created.bytes), true);
  artifacts.close();
});
