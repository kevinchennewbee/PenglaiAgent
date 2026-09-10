import { createHash, timingSafeEqual } from "node:crypto";
import { PenglaiError } from "./errors.js";

type OfficialImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
type MediaKind = "image" | "audio" | "office" | "pdf" | "file";
interface OfficialFileRef {
  attachmentId: string;
  name: string;
  bytes: number;
}
interface OfficialImageRef {
  attachmentId: string;
  mediaType: OfficialImageMediaType;
  bytes: number;
  width: number;
  height: number;
  name?: string;
}

export const INBOUND_MEDIA_RECEIPT_SCHEMA = 1;
const OFFICIAL_FILE_ID = /^sha256:[a-f0-9]{64}$/;
const OBJECT_HANDLE = /^obj-[0-9a-f]{24}$/;
const IMAGE_TYPES = new Set<OfficialImageMediaType>(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const RECEIPT_KINDS = ["image", "file", "office", "pdf", "audio"] as const;

export type InboundMediaReceiptKind = (typeof RECEIPT_KINDS)[number];

export interface InboundMediaReceipt {
  schema: typeof INBOUND_MEDIA_RECEIPT_SCHEMA;
  kind: InboundMediaReceiptKind;
  workspaceIdentity: string;
  sessionId: string;
  routeId: string;
  accountRef: string;
  bindingRevision: number;
  officialFile?: OfficialFileRef;
  officialImage?: OfficialImageRef;
  officeHandle?: string;
  audioHandle?: string;
}

function requireToken(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 256 || /[\u0000\r\n]/.test(value) || /[/\\]/.test(value)) {
    throw new PenglaiError("SECURITY_POLICY", `${label} rejected`);
  }
  return value;
}

export function assertOfficialFileRefShape(value: unknown): OfficialFileRef {
  if (!value || typeof value !== "object") throw new PenglaiError("SECURITY_POLICY", "official file receipt rejected");
  const rec = value as Record<string, unknown>;
  if (typeof rec.name !== "string" || !rec.name || /[/\\]/.test(rec.name) || /[\u0000-\u001f\u007f]/.test(rec.name)) {
    throw new PenglaiError("SECURITY_POLICY", "official file receipt rejected");
  }
  if (
    typeof rec.attachmentId !== "string" ||
    !OFFICIAL_FILE_ID.test(rec.attachmentId) ||
    !Number.isSafeInteger(rec.bytes) ||
    Number(rec.bytes) < 0 ||
    Number(rec.bytes) > 8 * 1024 * 1024
  ) {
    throw new PenglaiError("SECURITY_POLICY", "official file receipt rejected");
  }
  return { attachmentId: rec.attachmentId, name: rec.name, bytes: Number(rec.bytes) };
}

export function assertOfficialImageRefShape(value: unknown): OfficialImageRef {
  if (!value || typeof value !== "object") throw new PenglaiError("SECURITY_POLICY", "official image receipt rejected");
  const rec = value as Record<string, unknown>;
  if (
    typeof rec.attachmentId !== "string" ||
    !rec.attachmentId ||
    rec.attachmentId.length > 128 ||
    /[/\\]/.test(rec.attachmentId) ||
    typeof rec.mediaType !== "string" ||
    !IMAGE_TYPES.has(rec.mediaType as OfficialImageMediaType) ||
    !Number.isSafeInteger(rec.bytes) ||
    Number(rec.bytes) < 0 ||
    !Number.isSafeInteger(rec.width) ||
    Number(rec.width) < 1 ||
    !Number.isSafeInteger(rec.height) ||
    Number(rec.height) < 1
  ) {
    throw new PenglaiError("SECURITY_POLICY", "official image receipt rejected");
  }
  const ref: OfficialImageRef = {
    attachmentId: rec.attachmentId,
    mediaType: rec.mediaType as OfficialImageMediaType,
    bytes: Number(rec.bytes),
    width: Number(rec.width),
    height: Number(rec.height),
  };
  if (typeof rec.name === "string" && rec.name) {
    if (/[/\\]/.test(rec.name) || /[\u0000-\u001f\u007f]/.test(rec.name)) {
      throw new PenglaiError("SECURITY_POLICY", "official image receipt rejected");
    }
    ref.name = rec.name;
  }
  return ref;
}

function assertObjectHandle(value: unknown, label: string): string {
  if (typeof value !== "string" || !OBJECT_HANDLE.test(value)) {
    throw new PenglaiError("SECURITY_POLICY", `${label} rejected`);
  }
  return value;
}

function requireInboundMediaReceiptSchema(value: unknown): asserts value is typeof INBOUND_MEDIA_RECEIPT_SCHEMA {
  if (typeof value !== "number" || !Number.isInteger(value) || value !== INBOUND_MEDIA_RECEIPT_SCHEMA) {
    throw new PenglaiError("SECURITY_POLICY", "media receipt schema rejected");
  }
}

export function canonicalizeInboundMediaReceipt(receipt: InboundMediaReceipt): string {
  return JSON.stringify({
    schema: INBOUND_MEDIA_RECEIPT_SCHEMA,
    kind: receipt.kind,
    workspaceIdentity: receipt.workspaceIdentity,
    sessionId: receipt.sessionId,
    routeId: receipt.routeId,
    accountRef: receipt.accountRef,
    bindingRevision: receipt.bindingRevision,
    officialFile: receipt.officialFile ?? null,
    officialImage: receipt.officialImage ?? null,
    officeHandle: receipt.officeHandle ?? null,
    audioHandle: receipt.audioHandle ?? null,
  });
}

export function inboundMediaReceiptDigest(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildInboundMediaReceipt(input: {
  kind: MediaKind;
  workspaceIdentity: string;
  sessionId: string;
  routeId: string;
  accountRef: string;
  bindingRevision: number;
  officialFile?: OfficialFileRef;
  officialImage?: OfficialImageRef;
  officeHandle?: string;
  audioHandle?: string;
}): InboundMediaReceipt {
  if (!(RECEIPT_KINDS as readonly string[]).includes(input.kind)) {
    throw new PenglaiError("INVALID_INPUT", "media receipt kind rejected");
  }
  const receipt: InboundMediaReceipt = {
    schema: INBOUND_MEDIA_RECEIPT_SCHEMA,
    kind: input.kind,
    workspaceIdentity: requireToken(input.workspaceIdentity, "workspace"),
    sessionId: requireToken(input.sessionId, "session"),
    routeId: requireToken(input.routeId, "route"),
    accountRef: requireToken(input.accountRef, "account"),
    bindingRevision: input.bindingRevision,
  };
  if (!Number.isSafeInteger(receipt.bindingRevision) || receipt.bindingRevision < 1) {
    throw new PenglaiError("SECURITY_POLICY", "binding revision rejected");
  }
  if (input.officialFile) receipt.officialFile = assertOfficialFileRefShape(input.officialFile);
  if (input.officialImage) receipt.officialImage = assertOfficialImageRefShape(input.officialImage);
  if (input.officeHandle) receipt.officeHandle = assertObjectHandle(input.officeHandle, "office handle");
  if (input.audioHandle) receipt.audioHandle = assertObjectHandle(input.audioHandle, "audio handle");
  if (receipt.kind === "image" && !receipt.officialImage) {
    throw new PenglaiError("DSH_UNAVAILABLE", "image requires official DSH attachments.saveImage");
  }
  if ((receipt.kind === "file" || receipt.kind === "office" || receipt.kind === "pdf") && !receipt.officialFile) {
    throw new PenglaiError("DSH_UNAVAILABLE", "file requires official DSH attachments.saveFile");
  }
  if ((receipt.kind === "office" || receipt.kind === "pdf") && !receipt.officeHandle) {
    throw new PenglaiError("INVALID_INPUT", "office/pdf inbound requires a bound opaque office handle");
  }
  if (receipt.kind === "audio" && !receipt.audioHandle) {
    throw new PenglaiError("INVALID_INPUT", "audio inbound requires a bound opaque audio handle");
  }
  return receipt;
}

export function parseInboundMediaReceipt(rawJson: string, expectedDigest: string): InboundMediaReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch {
    throw new PenglaiError("SECURITY_POLICY", "media receipt payload rejected");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new PenglaiError("SECURITY_POLICY", "media receipt payload rejected");
  }
  const rec = parsed as Record<string, unknown>;
  requireInboundMediaReceiptSchema(rec.schema);
  const receipt = buildInboundMediaReceipt({
    kind: rec.kind as MediaKind,
    workspaceIdentity: rec.workspaceIdentity as string,
    sessionId: rec.sessionId as string,
    routeId: rec.routeId as string,
    accountRef: rec.accountRef as string,
    bindingRevision: Number(rec.bindingRevision),
    ...(rec.officialFile ? { officialFile: rec.officialFile as OfficialFileRef } : {}),
    ...(rec.officialImage ? { officialImage: rec.officialImage as OfficialImageRef } : {}),
    ...(typeof rec.officeHandle === "string" ? { officeHandle: rec.officeHandle } : {}),
    ...(typeof rec.audioHandle === "string" ? { audioHandle: rec.audioHandle } : {}),
  });
  const canonical = canonicalizeInboundMediaReceipt(receipt);
  const digest = inboundMediaReceiptDigest(canonical);
  const expected = Buffer.from(expectedDigest, "hex");
  const actual = Buffer.from(digest, "hex");
  if (expected.length !== 32 || actual.length !== 32 || !timingSafeEqual(expected, actual)) {
    throw new PenglaiError("SECURITY_POLICY", "media receipt digest rejected");
  }
  return receipt;
}
