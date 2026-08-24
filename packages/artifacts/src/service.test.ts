import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import { ARTIFACT_LIMITS } from "./policy.js";
import { ArtifactService } from "./service.js";

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function storedZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(entry.data), 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const loc = Buffer.concat([local, name, entry.data]);
    locals.push(loc);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(entry.data), 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += loc.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

function service(now = { t: 1_700_000_000_000 }, persist?: (actionId: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "penglai-artifacts-"));
  const artifacts = new ArtifactService(root, {
    now: () => now.t,
    ...(persist ? { assertPersist: persist } : {}),
  });
  return { artifacts, root, now };
}

test("R56-FILE-003 ArtifactRef never includes a filesystem path", () => {
  const { artifacts } = service();
  const ref = artifacts.ingestBytes(Buffer.from("hello artifact\n"), {
    name: "note.txt",
    source: "office",
    workspaceId: "ws-a",
    sessionId: "sess-1",
    turnId: "turn-1",
  });
  assert.equal(ref.schema, 1);
  assert.match(ref.id, /^sha256:[0-9a-f]{64}$/);
  assert.equal(ref.name, "note.txt");
  assert.equal("path" in ref, false);
  assert.doesNotMatch(JSON.stringify(ref), /\/Users\/|\/tmp\/|cas\//);
  artifacts.close();
});

test("R56-FILE-005/006/008 reject symlink, magic mismatch, macros, and executables", () => {
  const { artifacts, root } = service();
  const file = join(root, "ok.txt");
  writeFileSync(file, "plain\n");
  const linked = join(root, "alias.txt");
  symlinkSync(file, linked);
  assert.throws(() => artifacts.ingestPath(linked, { name: "alias.txt", source: "im" }), /SYMLINK|HANDLE/);
  assert.throws(
    () => artifacts.ingestBytes(Buffer.from("MZ\x90\x00not-an-office"), { name: "note.docx", source: "office" }),
    /MAGIC|FORBIDDEN/,
  );
  assert.throws(
    () => artifacts.ingestBytes(Buffer.from("MZ executable"), { name: "tool.exe", source: "im" }),
    /FORBIDDEN/,
  );
  const macro = storedZip([{ name: "word/vbaProject.bin", data: Buffer.from("macro") }]);
  assert.throws(() => artifacts.ingestBytes(macro, { name: "macro.docx", source: "office" }), /MACRO/);
  const mismatch = storedZip([{ name: "xl/workbook.xml", data: Buffer.from("<workbook/>") }]);
  assert.throws(() => artifacts.ingestBytes(mismatch, { name: "note.docx", source: "office" }), /MAGIC/);
  artifacts.close();
});

test("R56-FILE-007 turn file and byte caps fail closed", () => {
  const { artifacts } = service();
  const turn = { source: "office" as const, workspaceId: "ws-a", sessionId: "s", turnId: "t-cap" };
  for (let i = 0; i < ARTIFACT_LIMITS.maxTurnFiles; i += 1) {
    artifacts.ingestBytes(Buffer.from(`row-${i}\n`), { ...turn, name: `n${i}.txt` });
  }
  assert.throws(
    () => artifacts.ingestBytes(Buffer.from("one-more\n"), { ...turn, name: "overflow.txt" }),
    /TURN_COUNT/,
  );
  const { artifacts: other } = service();
  for (const name of ["a.txt", "b.txt", "c.txt"]) {
    other.ingestBytes(Buffer.alloc(ARTIFACT_LIMITS.maxFileBytes, 0x61), { name, source: "im", turnId: "t-bytes", workspaceId: "ws" });
  }
  assert.throws(
    () => other.ingestBytes(Buffer.from("x"), { name: "overflow.txt", source: "im", turnId: "t-bytes", workspaceId: "ws" }),
    /TURN_BYTES/,
  );
  artifacts.close();
  other.close();
});

test("R56-FILE-011/012 persist needs an owner action and GC removes CAS plus index", () => {
  const clock = { t: 1_700_000_000_000 };
  let allowed = "";
  const { artifacts, root } = service(clock, (actionId) => {
    if (actionId !== allowed) throw new PenglaiError("SECURITY_POLICY", "ARTIFACT_PERSIST_RECEIPT");
  });
  const ref = artifacts.ingestBytes(Buffer.from("keep me\n"), {
    name: "keep.md",
    source: "memory",
    workspaceId: "ws-a",
    sessionId: "sess-1",
    turnId: "turn-1",
  });
  assert.throws(() => artifacts.persist(ref.id, "workspace", { actionId: "not-a-uuid" }), /RECEIPT/);
  allowed = "11111111-1111-4111-8111-111111111111";
  const persisted = artifacts.persist(ref.id, "workspace", { actionId: allowed });
  assert.equal(persisted.scope, "workspace");
  assert.equal(persisted.expiresAt, undefined);
  clock.t += ARTIFACT_LIMITS.turnTtlMs + 1;
  const stale = artifacts.ingestBytes(Buffer.from("temp\n"), {
    name: "temp.txt",
    source: "im",
    workspaceId: "ws-a",
    turnId: "turn-2",
  });
  clock.t += ARTIFACT_LIMITS.turnTtlMs + 1;
  const cleaned = artifacts.gc();
  assert.equal(cleaned.removed >= 1, true);
  assert.throws(() => artifacts.ref(stale.id), /MISSING/);
  assert.equal(artifacts.ref(ref.id).scope, "workspace");
  mkdirSync(join(root, "staging", "leftover"), { recursive: true });
  artifacts.gc();
  artifacts.close();
});

test("R56-FILE-013 workspace or session drift cannot read the handle", () => {
  const { artifacts } = service();
  const docx = storedZip([
    { name: "word/document.xml", data: Buffer.from("<w:document/>") },
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
  ]);
  const ref = artifacts.ingestBytes(docx, {
    name: "brief.docx",
    source: "office",
    workspaceId: "ws-a",
    sessionId: "sess-1",
    turnId: "turn-1",
  });
  const body = artifacts.readControlled(ref.id, { workspaceId: "ws-a", sessionId: "sess-1", turnId: "turn-1" });
  assert.equal(body.name, "brief.docx");
  assert.equal(body.bytes.equals(docx), true);
  assert.throws(
    () => artifacts.readControlled(ref.id, { workspaceId: "ws-b", sessionId: "sess-1" }),
    /WORKSPACE/,
  );
  assert.throws(
    () => artifacts.readControlled(ref.id, { workspaceId: "ws-a", sessionId: "sess-other" }),
    /SESSION/,
  );
  artifacts.close();
});

test("R56-FILE-016 composer Turn binding stays blocked on rc.2", () => {
  const { artifacts } = service();
  artifacts.ingestBytes(Buffer.from("%PDF-1.4\n%%EOF\n"), {
    name: "page.pdf",
    source: "composer",
    workspaceId: "ws-a",
    turnId: "turn-1",
  });
  assert.throws(() => artifacts.bindComposerTurn(), (error: unknown) => {
    return error instanceof PenglaiError && error.errorClass === "DSH_CONTRACT_DRIFT";
  });
  artifacts.close();
});
