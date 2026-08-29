export const UNGROUPED_LABEL = "未分组";
export const UNGROUPED_LABEL_EN = "Ungrouped";

export type MenuLocale = "zh" | "en";

export interface MenuWorkspace {
  id: string;
  title: string;
  group?: string;
  sessionIds?: readonly string[];
}

export interface MenuSession {
  id: string;
  title?: string;
}

export interface MenuChoice {
  n: number;
  workspaceId: string;
  sessionId?: string;
  label: string;
}

export interface PendingMenu {
  kind: "projects" | "sessions";
  locale: MenuLocale;
  choices: MenuChoice[];
  createdAt: number;
}

const MAX_SESSION_TITLE_CODE_POINTS = 120;

const NUMBER_REPLY = /^\s*(\d+)(?:[.\u3001、)]|\s)?\s*$/u;

const COPY = {
  zh: {
    ungrouped: UNGROUPED_LABEL,
    helpUnauthorized: "蓬莱还没准备好。请先在桌面完成首次引导，再扫码后发消息。",
    help: [
      "蓬莱命令：",
      "1. /帮助 — 查看这份说明",
      "2. /项目 — 列出工作区，回复数字切换",
      "3. /会话 — 列出当前工作区会话，回复数字切换",
      "4. /新建 — 新建会话",
      "5. /状态 — 查看工作区、会话和队列",
      "6. /模型 — 查看当前模型；/模型 <供应商/模型> 切换",
      "7. /停止 — 停止当前任务",
      "8. /重置 — 重新连到默认会话",
      "9. /插话 <文字> — 插入当前任务",
      "10. /资料 /记忆 /预算 /陪伴 /语音 — 查看对应状态",
      "11. /版本 — 查看蓬莱与核心钉选，不进入模型",
      "直接发消息即可对话。列表出现后，回复数字就能选。",
    ].join("\n"),
    projectsTitle: "项目：",
    sessionMark: (n: number) => ` · ${n} 个会话`,
    currentMark: "（当前）",
    projectsEmpty: "还没有可切换的项目。",
    projectsFooter: "回复数字切换项目，再发送 /会话 选具体会话。",
    sessionsTitle: (title: string) => `会话 · ${title}：`,
    sessionsEmpty: (title: string) => `【${title}】还没有会话。发送 /新建 可以开一个。`,
    sessionsFooter: "回复数字切换会话。",
    missingItem: (n: number) => `没有第 ${n} 项。请重新发送 /项目 或 /会话。`,
    switched: (label: string) => `已切换到 ${label}`,
  },
  en: {
    ungrouped: UNGROUPED_LABEL_EN,
    helpUnauthorized: "Penglai is not ready yet. Finish first-run on the desktop, then scan and send a message.",
    help: [
      "Penglai commands:",
      "1. /help — show this list",
      "2. /projects — list workspaces, reply with a number to switch",
      "3. /sessions — list sessions in the current workspace, reply with a number to switch",
      "4. /new — create a session",
      "5. /status — workspace, session, and queue",
      "6. /model — current model; /model <provider/model> to switch",
      "7. /stop — stop the current task",
      "8. /reset — reconnect to the default session",
      "9. /steer <text> — insert into the current task",
      "10. /context /memory /budget /companion /voice — status",
      "11. /version — show Penglai and core pins, no model turn",
      "Send a message to talk. After a list appears, reply with a number to pick.",
    ].join("\n"),
    projectsTitle: "Projects:",
    sessionMark: (n: number) => ` · ${n} sessions`,
    currentMark: " (current)",
    projectsEmpty: "There are no projects to switch to.",
    projectsFooter: "Reply with a number to switch projects, then send /sessions to pick a session.",
    sessionsTitle: (title: string) => `Sessions · ${title}:`,
    sessionsEmpty: (title: string) => `[${title}] has no sessions. Send /new to create one.`,
    sessionsFooter: "Reply with a number to switch sessions.",
    missingItem: (n: number) => `There is no item ${n}. Send /projects or /sessions again.`,
    switched: (label: string) => `Switched to ${label}`,
  },
} as const;

export function parseMenuPick(text: string): number | undefined {
  const match = NUMBER_REPLY.exec(text.trim());
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function commandLocale(text: string): MenuLocale {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return "zh";
  const body = trimmed.slice(1);
  const space = body.search(/\s/u);
  const name = space === -1 ? body : body.slice(0, space);
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(name) ? "en" : "zh";
}

export function groupLabel(workspace: MenuWorkspace, locale: MenuLocale = "zh"): string {
  const named = workspace.group?.trim();
  if (named) return named;
  return COPY[locale].ungrouped;
}

export function formatNumberedHelp(authorized: boolean, locale: MenuLocale = "zh"): string {
  return authorized ? COPY[locale].help : COPY[locale].helpUnauthorized;
}

export function formatProjectMenu(
  workspaces: MenuWorkspace[],
  currentWorkspaceId?: string,
  locale: MenuLocale = "zh",
  createdAt = 0,
): { text: string; menu: PendingMenu } {
  const copy = COPY[locale];
  const choices: MenuChoice[] = [];
  const groups = new Map<string, MenuWorkspace[]>();
  for (const workspace of workspaces) {
    const label = groupLabel(workspace, locale);
    const rows = groups.get(label) ?? [];
    rows.push(workspace);
    groups.set(label, rows);
  }
  const lines: string[] = [copy.projectsTitle];
  for (const [group, rows] of groups) {
    lines.push("", locale === "en" ? `[${group}]` : `【${group}】`);
    for (const workspace of rows) {
      const n = choices.length + 1;
      const sessions = workspace.sessionIds?.length ?? 0;
      const currentMark = currentWorkspaceId === workspace.id ? copy.currentMark : "";
      const sessionMark = sessions > 0 ? copy.sessionMark(sessions) : "";
      choices.push({ n, workspaceId: workspace.id, label: workspace.title });
      lines.push(`${n}. ${workspace.title}${sessionMark}${currentMark}`);
    }
  }
  if (choices.length === 0) {
    return {
      text: copy.projectsEmpty,
      menu: { kind: "projects", locale, choices: [], createdAt },
    };
  }
  lines.push("", copy.projectsFooter);
  return { text: lines.join("\n"), menu: { kind: "projects", locale, choices, createdAt } };
}

export function formatSessionMenu(
  workspaceTitle: string,
  sessions: MenuSession[],
  currentSessionId?: string,
  workspaceId?: string,
  locale: MenuLocale = "zh",
  createdAt = 0,
): { text: string; menu: PendingMenu } {
  const copy = COPY[locale];
  if (!workspaceId || sessions.length === 0) {
    return {
      text: copy.sessionsEmpty(workspaceTitle),
      menu: { kind: "sessions", locale, choices: [], createdAt },
    };
  }
  const choices: MenuChoice[] = [];
  const lines: string[] = [copy.sessionsTitle(workspaceTitle)];
  for (const session of sessions) {
    const n = choices.length + 1;
    const suppliedTitle = session.title?.trim();
    const title = suppliedTitle
      ? Array.from(suppliedTitle).slice(0, MAX_SESSION_TITLE_CODE_POINTS).join("")
      : locale === "en"
        ? `Untitled session ${n}`
        : `未命名会话 ${n}`;
    const currentMark = currentSessionId === session.id ? copy.currentMark : "";
    choices.push({ n, workspaceId, sessionId: session.id, label: title });
    lines.push(`${n}. ${title}${currentMark}`);
  }
  lines.push("", copy.sessionsFooter);
  return { text: lines.join("\n"), menu: { kind: "sessions", locale, choices, createdAt } };
}

export function menuMissingItem(n: number, locale: MenuLocale = "zh"): string {
  return COPY[locale].missingItem(n);
}

export function menuSwitched(label: string, locale: MenuLocale = "zh"): string {
  return COPY[locale].switched(label);
}

export function pickFromMenu(menu: PendingMenu | undefined, n: number): MenuChoice | undefined {
  return menu?.choices.find((choice) => choice.n === n);
}
