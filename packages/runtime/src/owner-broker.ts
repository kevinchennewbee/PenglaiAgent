import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PenglaiError, parseClosedEnum, readExactRegularFile } from "@penglai/contracts";

export const OWNER_ACTIONS = [
  "office.commit",
  "office.commit-path",
  "office.export",
  "office.return",
  "office.undo",
  "office.discard",
  "memory.accept",
  "memory.personal",
  "memory.personalize",
  "memory.correct",
  "memory.forget",
  "memory.import",
  "memory.delete",
  "memory.promote-sop",
  "memory.sources-revoke",
  "artifact.persist",
  "plugin.install",
  "plugin.update",
  "plugin.enable",
  "plugin.disable",
  "plugin.rollback",
  "plugin.uninstall",
  "im.bind",
  "im.rebind",
  "im.remove",
  "im.enableGroup",
  "companion.enable",
  "budget.set-policy",
] as const;

export type OwnerAction = (typeof OWNER_ACTIONS)[number];

export const OWNER_RECEIPT_TTL_MS = 120_000;
export const OWNER_PROPOSAL_TTL_MS = 15 * 60 * 1000;

export interface ApprovalIntentV1 {
  schema: 1;
  actionId: string;
  action: OwnerAction;
  pluginId: string;
  objectId: string;
  sourceDigest: string;
  issuedAt: string;
  expiresAt: string;
  workspaceId?: string;
  sessionId?: string;
  resultDigest?: string;
  destinationLabel?: string;
  permissionDigest?: string;
}

export interface ApprovalReceiptV1 {
  schema: 1;
  receiptId: string;
  actionId: string;
  intentDigest: string;
  decision: "approved";
  approvedAt: string;
  expiresAt: string;
  nonce: string;
}

export type OwnerProposalState = "proposed" | "denied" | "approved" | "reserved" | "committed" | "expired";

export interface OwnerDialogRequest {
  actionId: string;
  action: OwnerAction;
  pluginId: string;
  reversible: boolean;
  noticeEn: string;
  noticeZh: string;
  workspaceLabel?: string;
  destinationLabel?: string;
}

export type OwnerDialogPort = (request: OwnerDialogRequest) => Promise<"approved" | "denied">;

export interface OwnerBrokerLog {
  actionId: string;
  action: OwnerAction;
  at: string;
  intentDigest: string;
  result: OwnerProposalState | "denied" | "replay" | "mismatch";
}

interface StoredProposal {
  intent: ApprovalIntentV1;
  intentDigest: string;
  state: OwnerProposalState;
  receiptId?: string;
  nonce?: string;
  reservationId?: string;
}

const NOTICE_EN =
  "This confirmation is not a sandbox against the same OS user or a shared-process plugin. Official Penglai actions cannot happen silently, replay, or bind the wrong object.";
const NOTICE_ZH =
  "此确认不是针对同一操作系统用户或同进程插件的沙箱。蓬莱官方动作不能静默发生、不能重放、不能绑错对象。";

function fail(message: string): never {
  throw new PenglaiError("SECURITY_POLICY", message);
}

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function digestIntent(intent: ApprovalIntentV1): string {
  return `sha256:${sha256Hex(JSON.stringify(intent))}`;
}

function assertDigest(value: string, label: string): string {
  const hex = value.replace(/^sha256:/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) fail(`${label} digest`);
  return `sha256:${hex}`;
}

function assertSafeLabel(label: string | undefined): void {
  if (label === undefined) return;
  if (
    label.includes("\0") ||
    label.includes("/") ||
    label.includes("\\") ||
    /sk-|token|secret|password|\/Users\/|\/home\//i.test(label)
  ) {
    fail("OWNER_DESTINATION_LABEL");
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(tmp, path);
}

function writeJsonExclusive(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
}

function readJson(path: string): unknown {
  return JSON.parse(readExactRegularFile(path, 256 * 1024).toString("utf8"));
}

export function createOwnerHmacKey(root: string): Buffer {
  const path = join(root, "owner-broker", "hmac.key");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path, randomBytes(32), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const key = readExactRegularFile(path, 32);
  if (key.length !== 32) fail("OWNER_HMAC_KEY");
  return key;
}

export class OwnerApprovalBroker {
  private readonly key: Buffer;
  private readonly now: () => number;
  private readonly dialog: OwnerDialogPort;
  private readonly onLog?: (log: OwnerBrokerLog) => void;

  constructor(private readonly root: string, opts: { dialog: OwnerDialogPort; now?: () => number; onLog?: (log: OwnerBrokerLog) => void }) {
    this.key = createOwnerHmacKey(root);
    this.now = opts.now ?? Date.now;
    this.dialog = opts.dialog;
    if (opts.onLog) this.onLog = opts.onLog;
  }

  private proposalPath(actionId: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actionId)) {
      fail("OWNER_ACTION_ID");
    }
    return join(this.root, "owner-broker", "proposals", `${actionId}.json`);
  }

  private noncePath(nonce: string): string {
    if (!/^[0-9a-f]{32}$/.test(nonce)) fail("OWNER_NONCE");
    return join(this.root, "owner-broker", "nonces", `${nonce}.json`);
  }

  private load(actionId: string): StoredProposal {
    const path = this.proposalPath(actionId);
    let raw: StoredProposal;
    try {
      raw = readJson(path) as StoredProposal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("OWNER_PROPOSAL_MISSING");
      throw error;
    }
    if (!raw?.intent || digestIntent(raw.intent) !== raw.intentDigest) fail("OWNER_PROPOSAL_TAMPER");
    return raw;
  }

  private save(row: StoredProposal): void {
    writeJsonAtomic(this.proposalPath(row.intent.actionId), row);
  }

  private log(row: StoredProposal, result: OwnerBrokerLog["result"]): void {
    this.onLog?.({
      actionId: row.intent.actionId,
      action: row.intent.action,
      at: new Date(this.now()).toISOString(),
      intentDigest: row.intentDigest,
      result,
    });
  }

  createProposal(input: {
    action: string;
    pluginId: string;
    objectId: string;
    sourceDigest: string;
    workspaceId?: string;
    sessionId?: string;
    resultDigest?: string;
    destinationLabel?: string;
    permissionDigest?: string;
  }): ApprovalIntentV1 {
    const action = parseClosedEnum(input.action, OWNER_ACTIONS, "OWNER_ACTION", "SECURITY_POLICY");
    if (!input.pluginId || !input.objectId) fail("OWNER_PROPOSAL_IDENTITY");
    assertSafeLabel(input.destinationLabel);
    const issued = this.now();
    const intent: ApprovalIntentV1 = {
      schema: 1,
      actionId: randomUUID(),
      action,
      pluginId: input.pluginId,
      objectId: input.objectId,
      sourceDigest: assertDigest(input.sourceDigest, "source"),
      issuedAt: new Date(issued).toISOString(),
      expiresAt: new Date(issued + OWNER_PROPOSAL_TTL_MS).toISOString(),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.resultDigest ? { resultDigest: assertDigest(input.resultDigest, "result") } : {}),
      ...(input.destinationLabel ? { destinationLabel: input.destinationLabel } : {}),
      ...(input.permissionDigest ? { permissionDigest: assertDigest(input.permissionDigest, "permission") } : {}),
    };
    const row: StoredProposal = { intent, intentDigest: digestIntent(intent), state: "proposed" };
    this.save(row);
    this.log(row, "proposed");
    return intent;
  }

  requestOwnerApproval(actionId: unknown): Promise<{ decision: "denied" } | { decision: "approved"; receipt: string }> {
    if (typeof actionId !== "string" || arguments.length !== 1) fail("OWNER_RENDERER_CONTRACT");
    return this.approveFromStore(actionId);
  }

  private async approveFromStore(
    actionId: string,
  ): Promise<{ decision: "denied" } | { decision: "approved"; receipt: string }> {
    const row = this.load(actionId);
    if (Date.parse(row.intent.expiresAt) <= this.now()) {
      row.state = "expired";
      this.save(row);
      this.log(row, "expired");
      fail("OWNER_PROPOSAL_EXPIRED");
    }
    if (row.state !== "proposed") fail("OWNER_PROPOSAL_STATE");
    const decision = await this.dialog({
      actionId: row.intent.actionId,
      action: row.intent.action,
      pluginId: row.intent.pluginId,
      reversible: row.intent.action === "office.undo" || row.intent.action === "plugin.rollback",
      noticeEn: NOTICE_EN,
      noticeZh: NOTICE_ZH,
      ...(row.intent.workspaceId ? { workspaceLabel: row.intent.workspaceId } : {}),
      ...(row.intent.destinationLabel ? { destinationLabel: row.intent.destinationLabel } : {}),
    });
    if (decision !== "approved") {
      row.state = "denied";
      this.save(row);
      this.log(row, "denied");
      return { decision: "denied" };
    }
    const approvedAt = this.now();
    const receipt: ApprovalReceiptV1 = {
      schema: 1,
      receiptId: randomUUID(),
      actionId: row.intent.actionId,
      intentDigest: row.intentDigest,
      decision: "approved",
      approvedAt: new Date(approvedAt).toISOString(),
      expiresAt: new Date(approvedAt + OWNER_RECEIPT_TTL_MS).toISOString(),
      nonce: randomBytes(16).toString("hex"),
    };
    const payload = Buffer.from(JSON.stringify(receipt), "utf8").toString("base64url");
    const mac = createHmac("sha256", this.key).update(payload).digest("base64url");
    row.state = "approved";
    row.receiptId = receipt.receiptId;
    row.nonce = receipt.nonce;
    this.save(row);
    this.log(row, "approved");
    return { decision: "approved", receipt: `${payload}.${mac}` };
  }

  consumeApproval(input: { receipt: unknown; intentDigest: string; actionId: string }): { reservationId: string } {
    if (typeof input.receipt !== "string" || !input.receipt.includes(".")) fail("OWNER_RECEIPT");
    const [payload, mac] = input.receipt.split(".");
    if (!payload || !mac) fail("OWNER_RECEIPT");
    const expectedMac = createHmac("sha256", this.key).update(payload).digest("base64url");
    const left = Buffer.from(mac);
    const right = Buffer.from(expectedMac);
    if (left.length !== right.length || !timingSafeEqual(left, right)) fail("OWNER_RECEIPT");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ApprovalReceiptV1;
    if (claims.schema !== 1 || claims.decision !== "approved" || claims.actionId !== input.actionId) fail("OWNER_RECEIPT");
    if (Date.parse(claims.expiresAt) <= this.now()) fail("OWNER_RECEIPT_EXPIRED");
    const nonceFile = this.noncePath(claims.nonce);
    try {
      writeJsonExclusive(nonceFile, {
        nonce: claims.nonce,
        actionId: claims.actionId,
        usedAt: new Date(this.now()).toISOString(),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      this.log(this.load(input.actionId), "replay");
      fail("OWNER_RECEIPT_REPLAY");
    }
    const row = this.load(input.actionId);
    if (row.state !== "approved") fail("OWNER_PROPOSAL_STATE");
    if (row.intentDigest !== claims.intentDigest || row.intentDigest !== assertDigest(input.intentDigest, "current")) {
      this.log(row, "mismatch");
      fail("OWNER_INTENT_MISMATCH");
    }
    const reservationId = randomUUID();
    row.state = "reserved";
    row.reservationId = reservationId;
    this.save(row);
    this.log(row, "reserved");
    return { reservationId };
  }

  completeApproval(input: { actionId: string; reservationId: string; resultDigest: string }): void {
    const row = this.load(input.actionId);
    if (row.state !== "reserved" || row.reservationId !== input.reservationId) fail("OWNER_PROPOSAL_STATE");
    const resultDigest = assertDigest(input.resultDigest, "result");
    if (row.intent.resultDigest && row.intent.resultDigest !== resultDigest) {
      this.log(row, "mismatch");
      fail("OWNER_RESULT_MISMATCH");
    }
    row.state = "committed";
    this.save(row);
    this.log(row, "committed");
  }

  inspect(actionId: string): {
    actionId: string;
    action: OwnerAction;
    state: OwnerProposalState;
    intentDigest: string;
    objectId: string;
    sourceDigest: string;
    workspaceId?: string;
    sessionId?: string;
    resultDigest?: string;
    destinationLabel?: string;
    permissionDigest?: string;
    pluginId: string;
  } {
    const row = this.load(actionId);
    return {
      actionId: row.intent.actionId,
      action: row.intent.action,
      state: row.state,
      intentDigest: row.intentDigest,
      objectId: row.intent.objectId,
      sourceDigest: row.intent.sourceDigest,
      pluginId: row.intent.pluginId,
      ...(row.intent.workspaceId ? { workspaceId: row.intent.workspaceId } : {}),
      ...(row.intent.sessionId ? { sessionId: row.intent.sessionId } : {}),
      ...(row.intent.resultDigest ? { resultDigest: row.intent.resultDigest } : {}),
      ...(row.intent.destinationLabel ? { destinationLabel: row.intent.destinationLabel } : {}),
      ...(row.intent.permissionDigest ? { permissionDigest: row.intent.permissionDigest } : {}),
    };
  }
}

export function requestOwnerApprovalArgs(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("OWNER_RENDERER_CONTRACT");
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== "actionId") fail("OWNER_RENDERER_CONTRACT");
  const actionId = (raw as { actionId?: unknown }).actionId;
  if (typeof actionId !== "string") fail("OWNER_RENDERER_CONTRACT");
  return actionId;
}
