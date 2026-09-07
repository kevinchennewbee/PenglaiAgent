import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { PenglaiError } from "@penglai/contracts";

export const OFFICIAL_REQUEST_KINDS = ["question", "approval"] as const;
export type OfficialRequestKind = (typeof OFFICIAL_REQUEST_KINDS)[number];
export const OFFICIAL_REQUEST_STATES = ["open", "answered", "expired", "cancelled"] as const;
export type OfficialRequestState = (typeof OFFICIAL_REQUEST_STATES)[number];

export interface OfficialImRequest {
  requestId: string;
  channel: string;
  accountId: string;
  peerId: string;
  kind: OfficialRequestKind;
  prompt: string;
  objectId: string;
  cardToken?: string;
  expiresAt: number;
  state: OfficialRequestState;
  answer?: string;
}

const SQL = `
  CREATE TABLE IF NOT EXISTS im_official_requests (
    request_id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    account_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    prompt TEXT NOT NULL,
    object_id TEXT NOT NULL,
    card_token TEXT,
    expires_at INTEGER NOT NULL,
    state TEXT NOT NULL,
    answer TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS im_official_requests_peer ON im_official_requests(channel, account_id, peer_id, state);
`;

export class OfficialImRequestStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(SQL);
  }

  create(input: {
    channel: string;
    accountId: string;
    peerId: string;
    kind: OfficialRequestKind;
    prompt: string;
    objectId: string;
    ttlMs?: number;
    cardToken?: string;
    now?: number;
  }): OfficialImRequest {
    if (!OFFICIAL_REQUEST_KINDS.includes(input.kind)) throw new PenglaiError("INVALID_INPUT", "OFFICIAL_REQUEST_KIND");
    if (!input.channel || !input.accountId || !input.peerId || !input.objectId) {
      throw new PenglaiError("INVALID_INPUT", "OFFICIAL_REQUEST_IDENTITY");
    }
    const now = input.now ?? Date.now();
    const ttl = input.ttlMs ?? 15 * 60_000;
    const row: OfficialImRequest = {
      requestId: `req:${randomUUID()}`,
      channel: input.channel,
      accountId: input.accountId,
      peerId: input.peerId,
      kind: input.kind,
      prompt: input.prompt.slice(0, 4000),
      objectId: input.objectId,
      expiresAt: now + ttl,
      state: "open",
      ...(input.cardToken ? { cardToken: input.cardToken } : {}),
    };
    this.db.prepare(
      `INSERT INTO im_official_requests(request_id, channel, account_id, peer_id, kind, prompt, object_id, card_token, expires_at, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.requestId, row.channel, row.accountId, row.peerId, row.kind, row.prompt, row.objectId, row.cardToken ?? null, row.expiresAt, row.state, now);
    return row;
  }

  get(requestId: string): OfficialImRequest | undefined {
    const raw = this.db.prepare(`SELECT * FROM im_official_requests WHERE request_id = ?`).get(requestId) as Record<string, string | number | null> | undefined;
    return raw ? this.map(raw) : undefined;
  }

  answer(input: {
    requestId: string;
    channel: string;
    accountId: string;
    peerId: string;
    text: string;
    cardToken?: string;
    now?: number;
  }): OfficialImRequest {
    const row = this.get(input.requestId);
    if (!row) throw new PenglaiError("INVALID_INPUT", "OFFICIAL_REQUEST_MISSING");
    const now = input.now ?? Date.now();
    if (row.state === "answered") throw new PenglaiError("SECURITY_POLICY", "OFFICIAL_REQUEST_REPLAY");
    if (row.state !== "open") throw new PenglaiError("SECURITY_POLICY", "OFFICIAL_REQUEST_CLOSED");
    if (row.expiresAt <= now) {
      this.db.prepare(`UPDATE im_official_requests SET state = 'expired' WHERE request_id = ? AND state = 'open'`).run(row.requestId);
      throw new PenglaiError("SECURITY_POLICY", "OFFICIAL_REQUEST_EXPIRED");
    }
    if (row.channel !== input.channel || row.accountId !== input.accountId || row.peerId !== input.peerId) {
      throw new PenglaiError("UNAUTHORIZED", "OFFICIAL_REQUEST_PEER");
    }
    if (row.cardToken && row.cardToken !== input.cardToken) {
      throw new PenglaiError("UNAUTHORIZED", "OFFICIAL_REQUEST_CARD");
    }
    const answer = input.text.trim().slice(0, 4000);
    if (!answer) throw new PenglaiError("INVALID_INPUT", "OFFICIAL_REQUEST_EMPTY");
    this.db.prepare(`UPDATE im_official_requests SET state = 'answered', answer = ? WHERE request_id = ? AND state = 'open'`).run(answer, row.requestId);
    return { ...row, state: "answered", answer };
  }

  tryAnswerFromInbound(input: { channel: string; accountId: string; peerId: string; text: string; now?: number }): string | undefined {
    const now = input.now ?? Date.now();
    this.db.prepare(`UPDATE im_official_requests SET state = 'expired' WHERE state = 'open' AND expires_at <= ?`).run(now);
    const open = this.db.prepare(
      `SELECT * FROM im_official_requests WHERE channel = ? AND account_id = ? AND peer_id = ? AND state = 'open' ORDER BY created_at DESC LIMIT 1`,
    ).get(input.channel, input.accountId, input.peerId) as Record<string, string | number | null> | undefined;
    if (!open) return undefined;
    const row = this.map(open);
    try {
      const answered = this.answer({
        requestId: row.requestId,
        channel: input.channel,
        accountId: input.accountId,
        peerId: input.peerId,
        text: input.text,
        ...(row.cardToken ? { cardToken: row.cardToken } : {}),
        now,
      });
      return `official-${answered.kind}-answered:${answered.requestId}`;
    } catch {
      return undefined;
    }
  }

  requestDigest(row: OfficialImRequest): string {
    return createHash("sha256").update(JSON.stringify([row.requestId, row.channel, row.accountId, row.peerId, row.objectId, row.kind])).digest("hex");
  }

  private map(raw: Record<string, string | number | null>): OfficialImRequest {
    return {
      requestId: String(raw.request_id),
      channel: String(raw.channel),
      accountId: String(raw.account_id),
      peerId: String(raw.peer_id),
      kind: raw.kind as OfficialRequestKind,
      prompt: String(raw.prompt),
      objectId: String(raw.object_id),
      expiresAt: Number(raw.expires_at),
      state: raw.state as OfficialRequestState,
      ...(raw.card_token ? { cardToken: String(raw.card_token) } : {}),
      ...(raw.answer ? { answer: String(raw.answer) } : {}),
    };
  }
}
