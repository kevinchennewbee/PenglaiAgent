import { execFile as execFileCb } from "node:child_process";
import { homedir as osHomedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PenglaiError } from "@penglai/contracts";

const execFileAsync = promisify(execFileCb);

export const name = "imessage";
export const IMESSAGE_ACCOUNT_REF = "macos-messages";
export const IMESSAGE_BOT_REPLY_PREFIX = "🤖 Penglai\n";
export const IMESSAGE_NATIVE_CREDENTIAL = "macos-messages-native";
export const IMESSAGE_DIRECT_CHAT_STYLE = 45;

export type IMessageConnection =
  | "not_configured"
  | "connecting"
  | "connected"
  | "failed"
  | "disabled"
  | "blocked";

export type IMessagePermissionState = "unknown" | "granted" | "required" | "error" | "unsupported";

export interface IMessagePermissions {
  platform: string;
  database: IMessagePermissionState;
  automation: IMessagePermissionState;
}

export interface IMessageInbound {
  messageId: string;
  senderId: string;
  chatId: string;
  text: string;
  chatType: "private";
  accountRef: string;
}

export interface IMessageExecResult {
  stdout?: string;
  stderr?: string;
}

export type IMessageExecFile = (
  file: string,
  args: readonly string[],
  options?: { timeout?: number; maxBuffer?: number },
) => Promise<IMessageExecResult>;

const DEFAULT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 2_000;

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function appleScriptString(value: string): string {
  return JSON.stringify(value);
}

function permissionError(kind: string, message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  (error as Error & { code: string }).code = kind;
  return error;
}

function decodeRows(stdout: string | undefined): Array<Record<string, unknown>> {
  const text = String(stdout ?? "").trim();
  if (!text) return [];
  try {
    const rows = JSON.parse(text) as unknown;
    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  } catch (error) {
    throw new Error("macOS Messages returned invalid database output", { cause: error });
  }
}

export function defaultMessagesDbPath(home = osHomedir()): string {
  return join(home, "Library", "Messages", "chat.db");
}

export function normalizeIMessageChatGuid(value: unknown): string {
  const chatGuid = cleanString(typeof value === "object" && value ? (value as { chatGuid?: unknown }).chatGuid : value);
  if (!chatGuid || chatGuid.length > 512 || /[\r\n]/.test(chatGuid)) {
    throw new PenglaiError("INVALID_INPUT", "IMESSAGE_CHAT_GUID_REQUIRED");
  }
  return chatGuid;
}

export function normalizeIMessageAddress(value: unknown): string {
  const address = cleanString(value);
  if (!address || address.length > 512 || /[\r\n]/.test(address)) {
    throw new PenglaiError("INVALID_INPUT", "IMESSAGE_ADDRESS_REQUIRED");
  }
  return address;
}

export function normalizeIMessage(
  value: unknown,
  options: { botId?: string } = {},
): IMessageInbound | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.serviceName !== undefined && row.serviceName !== "iMessage") return null;
  const guid = cleanString(row.guid ?? row.id);
  const chatGuid = cleanString(row.chatGuid ?? row.chat_guid);
  const text = cleanString(row.text);
  const sender = cleanString(row.sender ?? row.handle_id);
  if (!guid || !chatGuid || !text || !sender) return null;
  if (text.startsWith(IMESSAGE_BOT_REPLY_PREFIX)) return null;
  if (row.isFromMe === 1 || row.isFromMe === true) return null;
  if (options.botId && sender === options.botId) return null;
  const style = Number(row.style ?? IMESSAGE_DIRECT_CHAT_STYLE);
  if (Number.isFinite(style) && style !== IMESSAGE_DIRECT_CHAT_STYLE) return null;
  return {
    messageId: guid,
    senderId: sender,
    chatId: chatGuid,
    text,
    chatType: "private",
    accountRef: IMESSAGE_ACCOUNT_REF,
  };
}

export class MacOSMessagesApi {
  readonly dbPath: string;
  private readonly execFile: IMessageExecFile;
  private readonly execFileOptions: { timeout: number; maxBuffer: number };
  private readonly osascript: (script: string) => Promise<IMessageExecResult>;
  private readonly platform: NodeJS.Platform;

  constructor(options: {
    dbPath?: string;
    execFileImpl?: IMessageExecFile;
    osascriptImpl?: (script: string) => Promise<IMessageExecResult>;
    platform?: NodeJS.Platform;
    homedir?: string;
  } = {}) {
    this.platform = options.platform ?? process.platform;
    this.dbPath = options.dbPath ?? defaultMessagesDbPath(options.homedir ?? osHomedir());
    this.execFileOptions = { timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 };
    this.execFile = options.execFileImpl ?? execFileAsync;
    this.osascript =
      options.osascriptImpl ??
      ((script) => this.execFile("/usr/bin/osascript", ["-e", script], this.execFileOptions));
  }

  private assertDarwin(): void {
    if (this.platform !== "darwin") {
      throw new PenglaiError("SECURITY_POLICY", "IMESSAGE_UNSUPPORTED_OS");
    }
  }

  async getPermissions(): Promise<IMessagePermissions> {
    const result: IMessagePermissions = {
      platform: this.platform,
      database: "unknown",
      automation: "unknown",
    };
    if (this.platform !== "darwin") {
      return { ...result, database: "unsupported", automation: "unsupported" };
    }
    try {
      await this.execFile(
        "/usr/bin/sqlite3",
        ["-json", this.dbPath, "SELECT 1 AS ok LIMIT 1;"],
        this.execFileOptions,
      );
      result.database = "granted";
    } catch (error) {
      result.database = /authorization denied|not authorized|unable to open database/i.test(
        String((error as { stderr?: string })?.stderr ?? error),
      )
        ? "required"
        : "error";
    }
    try {
      await this.osascript('tell application "Messages" to get name');
      result.automation = "granted";
    } catch (error) {
      result.automation = /not authorized|(-1743)|assistive/i.test(
        String((error as { stderr?: string })?.stderr ?? error),
      )
        ? "required"
        : "error";
    }
    return result;
  }

  async listMessages(input: { after?: number; limit?: number; chatGuid?: string } = {}): Promise<Array<Record<string, unknown>>> {
    this.assertDarwin();
    const cursor = Number.isSafeInteger(input.after) && (input.after ?? 0) >= 0 ? Number(input.after) : 0;
    const boundedLimit = Math.max(1, Math.min(100, Number(input.limit) || 50));
    const chatFilter = input.chatGuid ? ` AND c.guid = ${sqlString(normalizeIMessageChatGuid(input.chatGuid))}` : "";
    const query = `SELECT m.ROWID AS rowid, m.guid AS guid, m.text AS text,
      h.id AS sender, c.guid AS chatGuid, c.service_name AS serviceName,
      c.style AS style, m.is_from_me AS isFromMe,
      datetime((m.date / 1000000000) + 978307200, 'unixepoch') AS receivedAt
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE m.ROWID > ${cursor} AND m.is_from_me = 0
        AND m.text IS NOT NULL AND m.text != ''
        AND c.service_name = 'iMessage'
        AND c.style = ${IMESSAGE_DIRECT_CHAT_STYLE}${chatFilter}
      ORDER BY m.ROWID ASC LIMIT ${boundedLimit};`;
    try {
      const { stdout } = await this.execFile("/usr/bin/sqlite3", ["-json", this.dbPath, query], this.execFileOptions);
      return decodeRows(stdout);
    } catch (error) {
      if (/authorization denied|not authorized|unable to open database/i.test(String((error as { stderr?: string })?.stderr ?? error))) {
        throw permissionError("messages-database-permission-required", "Grant Penglai Full Disk Access in System Settings.", error);
      }
      throw error;
    }
  }

  async getLatestMessageRowId(): Promise<number> {
    this.assertDarwin();
    const query = `SELECT COALESCE(MAX(m.ROWID), 0) AS rowid
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      WHERE c.service_name = 'iMessage' AND c.style = ${IMESSAGE_DIRECT_CHAT_STYLE};`;
    const { stdout } = await this.execFile("/usr/bin/sqlite3", ["-json", this.dbPath, query], this.execFileOptions);
    const rows = decodeRows(stdout);
    const rowid = Number(rows[0]?.rowid ?? 0);
    return Number.isSafeInteger(rowid) && rowid >= 0 ? rowid : 0;
  }

  async sendText(input: { chatGuid?: string; address?: string; text?: string }): Promise<{ sent: true }> {
    this.assertDarwin();
    const target = normalizeIMessageChatGuid(input.chatGuid);
    const recipient = input.address
      ? normalizeIMessageAddress(input.address)
      : target.split(";").at(-1) || target;
    const content = cleanString(input.text);
    if (!content) throw new PenglaiError("INVALID_INPUT", "IMESSAGE_TEXT_REQUIRED");
    const reply = content.startsWith(IMESSAGE_BOT_REPLY_PREFIX)
      ? content
      : `${IMESSAGE_BOT_REPLY_PREFIX}${content}`;
    const script = `tell application "Messages"
      set serviceList to every service whose service type = iMessage
      if (count of serviceList) is 0 then error "No iMessage service is available"
      set targetService to item 1 of serviceList
      set targetBuddy to buddy ${appleScriptString(recipient)} of targetService
      send ${appleScriptString(reply)} to targetBuddy
    end tell`;
    try {
      await this.osascript(script);
      return { sent: true };
    } catch (error) {
      if (/not authorized|(-1743)|assistive/i.test(String((error as { stderr?: string })?.stderr ?? error))) {
        throw permissionError("messages-automation-permission-required", "Allow Penglai to control Messages in System Settings.", error);
      }
      throw error;
    }
  }
}

export class IMessageAdapter {
  connection: IMessageConnection = "disabled";
  accountRef: string | undefined;
  private cursor: number | null = null;
  private readonly seen = new Set<string>();
  private inboundHandler?: (msg: IMessageInbound) => void | Promise<void>;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private polling: Promise<void> | undefined;
  private generation = 0;
  private readonly api: MacOSMessagesApi;
  private readonly platform: NodeJS.Platform;
  private persist?: () => void;

  constructor(
    options: ConstructorParameters<typeof MacOSMessagesApi>[0] = {},
  ) {
    this.platform = options.platform ?? process.platform;
    this.api = new MacOSMessagesApi(options);
  }

  setPersist(handler: () => void): void {
    this.persist = handler;
  }

  health(): { channel: "imessage"; runtimeBundled: true; enabled: boolean; connection: IMessageConnection } {
    if (this.platform !== "darwin") {
      return { channel: "imessage", runtimeBundled: true, enabled: false, connection: "blocked" };
    }
    return {
      channel: "imessage",
      runtimeBundled: true,
      enabled: this.connection !== "disabled",
      connection: this.connection,
    };
  }

  async inspectPermissions(): Promise<IMessagePermissions> {
    if (this.platform !== "darwin") {
      return { platform: this.platform, database: "unsupported", automation: "unsupported" };
    }
    return this.api.getPermissions();
  }

  async beginConnection(input: { method?: string; credentialRef?: string }): Promise<{
    kind: "manual-fallback";
    connection: IMessageConnection;
    operationId: string;
  }> {
    void input.credentialRef;
    if (input.method && input.method !== "manual-fallback") {
      throw new PenglaiError("SECURITY_POLICY", "CHANNEL_METHOD_UNSUPPORTED");
    }
    if (this.platform !== "darwin") {
      this.connection = "blocked";
      throw new PenglaiError("SECURITY_POLICY", "IMESSAGE_UNSUPPORTED_OS");
    }
    this.connection = "connecting";
    const permissions = await this.api.getPermissions();
    if (permissions.database !== "granted" || permissions.automation !== "granted") {
      this.connection = "not_configured";
      throw new PenglaiError("AUTH_EXPIRED", "IMESSAGE_PERMISSION_REQUIRED");
    }
    if (this.cursor === null) {
      this.cursor = await this.api.getLatestMessageRowId();
    }
    this.accountRef = IMESSAGE_ACCOUNT_REF;
    this.connection = "connected";
    this.startReceive();
    this.persist?.();
    return { kind: "manual-fallback", connection: this.connection, operationId: "imessage:manual-fallback" };
  }

  async pollConnection(): Promise<{ status: IMessageConnection }> {
    return { status: this.connection };
  }

  onInbound(handler: (msg: IMessageInbound) => void | Promise<void>): void {
    this.inboundHandler = handler;
  }

  async sendText(input: { text: string; peerRef?: string }): Promise<{ delivered: true }> {
    if (this.connection !== "connected" || !this.accountRef) {
      throw new PenglaiError("SECURITY_POLICY", "IMESSAGE_NOT_CONNECTED");
    }
    const target = input.peerRef?.trim();
    if (!target) throw new PenglaiError("INVALID_INPUT", "IMESSAGE_CHAT_GUID_REQUIRED");
    await this.api.sendText({ chatGuid: target, text: input.text });
    return { delivered: true };
  }

  async disconnect(): Promise<void> {
    this.stopReceive();
    this.accountRef = undefined;
    this.connection = this.platform === "darwin" ? "not_configured" : "blocked";
  }

  async logout(): Promise<void> {
    await this.disconnect();
    this.cursor = null;
    this.seen.clear();
    this.connection = "disabled";
    this.persist?.();
  }

  exportPersistedState(): Record<string, unknown> {
    return {
      cursor: this.cursor,
      seenMessageIds: [...this.seen].slice(-1_000),
    };
  }

  restorePersistedState(state: Record<string, unknown>): void {
    const cursor = Number(state.cursor);
    this.cursor = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null;
    this.seen.clear();
    const seen = state.seenMessageIds;
    if (Array.isArray(seen)) {
      for (const id of seen) {
        if (typeof id === "string" && id) this.seen.add(id);
      }
    }
  }

  private startReceive(): void {
    if (this.platform !== "darwin" || this.connection !== "connected") return;
    const generation = ++this.generation;
    const loop = async () => {
      if (generation !== this.generation || this.connection !== "connected") return;
      this.polling = this.pollOnce().catch(() => undefined);
      await this.polling;
      if (generation !== this.generation || this.connection !== "connected") return;
      this.pollTimer = setTimeout(() => {
        void loop();
      }, POLL_INTERVAL_MS);
      this.pollTimer.unref?.();
    };
    void loop();
  }

  private stopReceive(): void {
    this.generation += 1;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    this.polling = undefined;
  }

  private async pollOnce(): Promise<void> {
    const rows = await this.api.listMessages({ after: this.cursor ?? 0, limit: 100 });
    for (const raw of rows) {
      const message = normalizeIMessage(raw, { botId: IMESSAGE_ACCOUNT_REF });
      const rowid = Number(raw.rowid);
      if (message && !this.seen.has(message.messageId)) {
        this.seen.add(message.messageId);
        await this.inboundHandler?.(message);
      }
      if (Number.isSafeInteger(rowid) && rowid >= 0) this.cursor = rowid;
    }
    if (this.seen.size > 1_000) {
      const keep = [...this.seen].slice(-1_000);
      this.seen.clear();
      for (const id of keep) this.seen.add(id);
    }
    this.persist?.();
  }
}
