import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  parseWeixinIlinkResponseObservation,
  type WeixinIlinkResponseObservation,
} from "@penglai/channel-weixin";
import { PenglaiError, parseClosedEnum } from "@penglai/contracts";
import { CHANNEL_CREDENTIAL_REFS } from "./credentials-vault.js";
import {
  isMessageFailureCode,
  isMessageFailureReference,
  messageFailureCopy,
  RECOVERY_ACTION_BY_CODE,
  type MessageFailureCode,
} from "./message-failure.js";
import { CHANNEL_IDS, getChannelManifest, type ChannelId } from "./registry.js";

export const IM_BOT_STATES = [
  "disabled",
  "connecting",
  "online",
  "degraded",
  "reconnecting",
  "blocked",
  "stopping",
] as const;

export type ImBotState = (typeof IM_BOT_STATES)[number];

export interface ImBotRow {
  botId: string;
  channelId: ChannelId;
  displayName: string;
  credentialRef: string;
  state: ImBotState;
  createdAt: number;
  updatedAt: number;
}

const SIDECAR_SQL = `
  CREATE TABLE IF NOT EXISTS im_v2_bots (
    bot_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    credential_ref TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS im_v2_bindings (
    binding_id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    session_id TEXT,
    version INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(bot_id) REFERENCES im_v2_bots(bot_id)
  );
  CREATE TABLE IF NOT EXISTS im_v2_channel_failures (
    channel_id TEXT NOT NULL,
    account_ref TEXT NOT NULL,
    code TEXT NOT NULL,
    message_zh TEXT NOT NULL,
    message_en TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    action TEXT NOT NULL,
    at INTEGER NOT NULL,
    transport_phase TEXT,
    http_status INTEGER,
    content_type TEXT,
    PRIMARY KEY (channel_id, account_ref)
  );
`;

export function ensureImV2Tables(db: DatabaseSync): void {
  db.exec(SIDECAR_SQL);
  const columns = new Set(
    (
      db.prepare("PRAGMA table_info(im_v2_channel_failures)").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
  for (const [name, declaration] of [
    ["transport_phase", "TEXT"],
    ["http_status", "INTEGER"],
    ["content_type", "TEXT"],
  ] as const) {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE im_v2_channel_failures ADD COLUMN ${name} ${declaration}`);
    }
  }
}

export class ImBotStore {
  constructor(private readonly db: DatabaseSync) {
    ensureImV2Tables(db);
  }

  list(channelId?: string): ImBotRow[] {
    const supportedChannel = channelId
      ? parseClosedEnum(channelId, CHANNEL_IDS, "CHANNEL_ID", "INVALID_INPUT")
      : undefined;
    const rows = supportedChannel
      ? (this.db.prepare(`SELECT * FROM im_v2_bots WHERE channel_id = ?`).all(supportedChannel) as Array<Record<string, string | number | null>>)
      : (this.db.prepare(`SELECT * FROM im_v2_bots`).all() as Array<Record<string, string | number | null>>);
    return rows
      .filter((row) => (CHANNEL_IDS as readonly string[]).includes(String(row.channel_id)))
      .map((row) => this.map(row));
  }

  create(input: { channelId: string; displayName: string }): ImBotRow {
    const channelId = parseClosedEnum(input.channelId, CHANNEL_IDS, "CHANNEL_ID", "INVALID_INPUT");
    const manifest = getChannelManifest(channelId);
    const now = Date.now();
    const row: ImBotRow = {
      botId: randomUUID(),
      channelId,
      displayName: input.displayName.trim() || manifest.displayName.en,
      credentialRef: CHANNEL_CREDENTIAL_REFS[channelId],
      state: manifest.defaultEnabled ? "connecting" : "disabled",
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO im_v2_bots(bot_id, channel_id, display_name, credential_ref, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.botId, row.channelId, row.displayName, row.credentialRef, row.state, row.createdAt, row.updatedAt);
    return row;
  }

  setState(botId: string, state: string): ImBotRow {
    const next = parseClosedEnum(state, IM_BOT_STATES, "IM_BOT_STATE", "SECURITY_POLICY");
    this.require(botId);
    const now = Date.now();
    this.db.prepare(`UPDATE im_v2_bots SET state = ?, updated_at = ? WHERE bot_id = ?`).run(next, now, botId);
    return this.require(botId);
  }

  remove(botId: string): void {
    this.require(botId);
    this.db.prepare(`DELETE FROM im_v2_bindings WHERE bot_id = ?`).run(botId);
    this.db.prepare(`DELETE FROM im_v2_bots WHERE bot_id = ?`).run(botId);
  }

  putChannelFailure(input: {
    channelId: ChannelId;
    accountRef: string;
    code: MessageFailureCode;
    referenceId: string;
    at: number;
    transport?: WeixinIlinkResponseObservation;
  }): void {
    if (
      !isMessageFailureCode(input.code) ||
      !isMessageFailureReference(input.referenceId) ||
      !Number.isSafeInteger(input.at) ||
      input.at < 0
    ) {
      throw new PenglaiError("SECURITY_POLICY", "IM_FAILURE_RECORD_INVALID");
    }
    const message = messageFailureCopy(input.code);
    const action = RECOVERY_ACTION_BY_CODE[input.code];
    const transport =
      input.channelId === "weixin"
        ? parseWeixinIlinkResponseObservation(input.transport)
        : undefined;
    this.db
      .prepare(
        `INSERT INTO im_v2_channel_failures(
           channel_id, account_ref, code, message_zh, message_en, reference_id,
           action, at, transport_phase, http_status, content_type
         )
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(channel_id, account_ref) DO UPDATE SET
           code=excluded.code,
           message_zh=excluded.message_zh,
           message_en=excluded.message_en,
           reference_id=excluded.reference_id,
           action=excluded.action,
           at=excluded.at,
           transport_phase=excluded.transport_phase,
           http_status=excluded.http_status,
           content_type=excluded.content_type`,
      )
      .run(
        input.channelId,
        input.accountRef,
        input.code,
        message.zh,
        message.en,
        input.referenceId,
        action,
        input.at,
        transport?.phase ?? null,
        transport?.httpStatus ?? null,
        transport?.contentType ?? null,
      );
  }

  getChannelFailure(channelId: ChannelId, accountRef: string): {
    channelId: ChannelId;
    accountRef: string;
    code: string;
    messageZh: string;
    messageEn: string;
    referenceId: string;
    action: string;
    at: number;
    transport?: WeixinIlinkResponseObservation;
  } | undefined {
    const row = this.db
      .prepare(`SELECT * FROM im_v2_channel_failures WHERE channel_id = ? AND account_ref = ?`)
      .get(channelId, accountRef) as Record<string, string | number> | undefined;
    if (!row) return undefined;
    const code = String(row.code);
    const referenceId = String(row.reference_id);
    const at = Number(row.at);
    if (
      !isMessageFailureCode(code) ||
      !isMessageFailureReference(referenceId) ||
      !Number.isSafeInteger(at) ||
      at < 0
    ) {
      return undefined;
    }
    const message = messageFailureCopy(code);
    const transport =
      channelId === "weixin"
        ? parseWeixinIlinkResponseObservation({
            phase: String(row.transport_phase ?? ""),
            httpStatus: Number(row.http_status),
            contentType: String(row.content_type ?? ""),
          })
        : undefined;
    return {
      channelId: parseClosedEnum(String(row.channel_id), CHANNEL_IDS, "CHANNEL_ID", "SECURITY_POLICY"),
      accountRef: String(row.account_ref),
      code,
      messageZh: message.zh,
      messageEn: message.en,
      referenceId,
      action: RECOVERY_ACTION_BY_CODE[code],
      at,
      ...(transport ? { transport } : {}),
    };
  }

  private require(botId: string): ImBotRow {
    const row = this.db.prepare(`SELECT * FROM im_v2_bots WHERE bot_id = ?`).get(botId) as Record<string, string | number | null> | undefined;
    if (!row) throw new PenglaiError("INVALID_INPUT", "IM_BOT_MISSING");
    return this.map(row);
  }

  private map(row: Record<string, string | number | null>): ImBotRow {
    return {
      botId: String(row.bot_id),
      channelId: parseClosedEnum(String(row.channel_id), CHANNEL_IDS, "CHANNEL_ID", "SECURITY_POLICY"),
      displayName: String(row.display_name),
      credentialRef: String(row.credential_ref),
      state: parseClosedEnum(String(row.state), IM_BOT_STATES, "IM_BOT_STATE", "SECURITY_POLICY"),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
}
