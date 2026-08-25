import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { PenglaiError, parseClosedEnum } from "@penglai/contracts";
import { CHANNEL_CREDENTIAL_REFS } from "./credentials-vault.js";
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
  riskAckAt: number | null;
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
    risk_ack_at INTEGER,
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
`;

export function ensureImV2Tables(db: DatabaseSync): void {
  db.exec(SIDECAR_SQL);
}

export class ImBotStore {
  constructor(private readonly db: DatabaseSync) {
    ensureImV2Tables(db);
  }

  list(channelId?: string): ImBotRow[] {
    const rows = channelId
      ? (this.db.prepare(`SELECT * FROM im_v2_bots WHERE channel_id = ?`).all(channelId) as Array<Record<string, string | number | null>>)
      : (this.db.prepare(`SELECT * FROM im_v2_bots`).all() as Array<Record<string, string | number | null>>);
    return rows.map((row) => this.map(row));
  }

  create(input: { channelId: string; displayName: string; riskAck?: boolean }): ImBotRow {
    const channelId = parseClosedEnum(input.channelId, CHANNEL_IDS, "CHANNEL_ID", "INVALID_INPUT");
    const manifest = getChannelManifest(channelId);
    if (manifest.risk === "community-protocol" && input.riskAck !== true) {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_RISK_ACK");
    }
    const now = Date.now();
    const row: ImBotRow = {
      botId: randomUUID(),
      channelId,
      displayName: input.displayName.trim() || manifest.displayName.en,
      credentialRef: CHANNEL_CREDENTIAL_REFS[channelId],
      state: manifest.defaultEnabled ? "connecting" : "disabled",
      riskAckAt: input.riskAck === true ? now : null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO im_v2_bots(bot_id, channel_id, display_name, credential_ref, state, risk_ack_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.botId, row.channelId, row.displayName, row.credentialRef, row.state, row.riskAckAt, row.createdAt, row.updatedAt);
    return row;
  }

  acknowledgeRisk(botId: string): ImBotRow {
    const row = this.require(botId);
    const now = Date.now();
    this.db.prepare(`UPDATE im_v2_bots SET risk_ack_at = ?, updated_at = ? WHERE bot_id = ?`).run(now, now, botId);
    return { ...row, riskAckAt: now, updatedAt: now };
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
      riskAckAt: row.risk_ack_at == null ? null : Number(row.risk_ack_at),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
}
