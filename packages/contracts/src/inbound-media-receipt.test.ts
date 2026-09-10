import assert from "node:assert/strict";
import test from "node:test";
import { PenglaiError } from "./errors.js";
import {
  INBOUND_MEDIA_RECEIPT_SCHEMA,
  buildInboundMediaReceipt,
  canonicalizeInboundMediaReceipt,
  inboundMediaReceiptDigest,
  parseInboundMediaReceipt,
} from "./inbound-media-receipt.js";

const FILE = { attachmentId: `sha256:${"ab".repeat(32)}`, name: "a.bin", bytes: 4 };
const IMAGE = {
  attachmentId: "att-img",
  mediaType: "image/png" as const,
  bytes: 67,
  width: 1,
  height: 1,
  name: "a.png",
};
const HANDLE = "obj-0123456789abcdef01234567";

function fileReceipt() {
  return buildInboundMediaReceipt({
    kind: "file",
    workspaceIdentity: "ws",
    sessionId: "sess",
    routeId: "r1",
    accountRef: "acct",
    bindingRevision: 1,
    officialFile: FILE,
  });
}

function parseWith(raw: string, digest: string) {
  return parseInboundMediaReceipt(raw, digest);
}

test("parseInboundMediaReceipt accepts a valid schema1 file receipt", () => {
  const receipt = fileReceipt();
  const raw = canonicalizeInboundMediaReceipt(receipt);
  const parsed = parseWith(raw, inboundMediaReceiptDigest(raw));
  assert.equal(parsed.schema, INBOUND_MEDIA_RECEIPT_SCHEMA);
  assert.equal(parsed.officialFile?.attachmentId, FILE.attachmentId);
  assert.equal(parsed.kind, "file");
});

test("parseInboundMediaReceipt preserves valid image, office, and audio schema1 receipts", () => {
  const image = buildInboundMediaReceipt({
    kind: "image",
    workspaceIdentity: "ws",
    sessionId: "sess",
    routeId: "r1",
    accountRef: "acct",
    bindingRevision: 1,
    officialImage: IMAGE,
  });
  const office = buildInboundMediaReceipt({
    kind: "office",
    workspaceIdentity: "ws",
    sessionId: "sess",
    routeId: "r1",
    accountRef: "acct",
    bindingRevision: 1,
    officialFile: { ...FILE, name: "note.pdf" },
    officeHandle: HANDLE,
  });
  const audio = buildInboundMediaReceipt({
    kind: "audio",
    workspaceIdentity: "ws",
    sessionId: "sess",
    routeId: "r1",
    accountRef: "acct",
    bindingRevision: 1,
    audioHandle: HANDLE,
  });
  for (const receipt of [image, office, audio]) {
    const raw = canonicalizeInboundMediaReceipt(receipt);
    const parsed = parseWith(raw, inboundMediaReceiptDigest(raw));
    assert.equal(parsed.schema, 1);
    assert.equal(parsed.kind, receipt.kind);
  }
  const parsedOffice = parseWith(
    canonicalizeInboundMediaReceipt(office),
    inboundMediaReceiptDigest(canonicalizeInboundMediaReceipt(office)),
  );
  assert.equal(parsedOffice.officeHandle, HANDLE);
  const parsedAudio = parseWith(
    canonicalizeInboundMediaReceipt(audio),
    inboundMediaReceiptDigest(canonicalizeInboundMediaReceipt(audio)),
  );
  assert.equal(parsedAudio.audioHandle, HANDLE);
});

test("parseInboundMediaReceipt rejects missing, unsupported, and non-integer schema even when the schema1 digest matches", () => {
  const receipt = fileReceipt();
  const raw = canonicalizeInboundMediaReceipt(receipt);
  const digest = inboundMediaReceiptDigest(raw);
  const base = JSON.parse(raw) as Record<string, unknown>;
  const reject = (payload: unknown, label: string) => {
    assert.throws(
      () => parseWith(JSON.stringify(payload), digest),
      (error: unknown) => {
        assert.ok(error instanceof PenglaiError, label);
        assert.equal(error.errorClass, "SECURITY_POLICY");
        assert.match(error.message, /media receipt schema rejected/);
        return true;
      },
      label,
    );
  };
  reject({ ...base, schema: 99 }, "unsupported schema 99");
  reject({ ...base, schema: undefined }, "missing schema via undefined");
  const { schema: _schema, ...withoutSchema } = base;
  reject(withoutSchema, "missing schema field");
  reject({ ...base, schema: 1.5 }, "non-integer schema");
  reject({ ...base, schema: "1" }, "string schema");
  reject({ ...base, schema: null }, "null schema");
  reject({ ...base, schema: true }, "boolean schema");
  const accepted = parseWith(raw, digest);
  assert.equal(accepted.schema, 1);
});
