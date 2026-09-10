/** Structured official DSH RemoteError projection. Never a string catch-all. */

export const AGENT_PRESET_REMOTE_CODE = /^agent-preset[-/]/u;

export interface OfficialRemoteFailure {
  code: string;
  message?: string;
}

const PRESET_COPY = Object.freeze({
  zh: "当前 Agent Preset 无法使用。请发送 /项目 选择工作区，再发送 /新建 创建新会话。如需继续原会话，请在官方 DSH 设置中恢复原 Preset。",
  en: "The current agent preset is unavailable. Send /projects to choose a workspace, then /new to start a new session. To keep the original session, restore the preset in official DSH settings.",
});

export function isAgentPresetRemoteCode(code: string): boolean {
  return AGENT_PRESET_REMOTE_CODE.test(code);
}

export function presetUnavailableCopy(): Readonly<{ zh: string; en: string }> {
  return PRESET_COPY;
}

/** Bilingual IM body. Commands are Penglai `/projects` `/new`, not dsh-im `/presetlist`. */
export function presetUnavailableUserText(): string {
  return `${PRESET_COPY.en}\n\n${PRESET_COPY.zh}`;
}

function readOfficialShape(value: unknown): OfficialRemoteFailure | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  const wrapped = rec.failure;
  if (wrapped && typeof wrapped === "object") {
    const failure = wrapped as Record<string, unknown>;
    if (typeof failure.code === "string" && failure.code) {
      return {
        code: failure.code,
        ...(typeof failure.message === "string" ? { message: failure.message } : {}),
      };
    }
  }
  if (rec.isDSHRemoteError === true && typeof rec.code === "string" && rec.code) {
    return {
      code: rec.code,
      ...(typeof rec.message === "string" ? { message: rec.message } : {}),
    };
  }
  return undefined;
}

/**
 * Walk `error.failure`, `isDSHRemoteError`, then bounded `Error.cause`.
 * Does not regex-scan messages and does not classify session-not-found.
 */
export function officialRemoteFailure(error: unknown, depth = 0): OfficialRemoteFailure | undefined {
  if (depth > 4 || error == null) return undefined;
  const direct = readOfficialShape(error);
  if (direct) return direct;
  if (typeof error === "object" && "cause" in error) {
    return officialRemoteFailure((error as { cause?: unknown }).cause, depth + 1);
  }
  return undefined;
}
