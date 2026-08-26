import { PenglaiError, type ControlCommand } from "@penglai/contracts";
import { formatNumberedHelp, type MenuLocale } from "./menu.js";

const COMMANDS = [
  "帮助",
  "help",
  "绑定",
  "bind",
  "解绑",
  "unbind",
  "状态",
  "status",
  "模型",
  "model",
  "项目",
  "projects",
  "会话",
  "sessions",
  "新建",
  "new",
  "插话",
  "steer",
  "停止当前",
  "stop",
  "清空本聊天队列",
  "clear",
  "资料",
  "记忆",
  "预算",
  "陪伴",
  "语音",
  "声音",
  "context",
  "memory",
  "budget",
  "companion",
  "voice",
  "voiceid",
  "version",
  "版本",
] as const;

export function parseCommand(text: string): ControlCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const body = trimmed.slice(1);
  const space = body.search(/\s/u);
  const name = (space === -1 ? body : body.slice(0, space)).toLowerCase();
  const rest = space === -1 ? "" : body.slice(space).trim();
  switch (name) {
    case "帮助":
    case "help":
      return { type: "help" };
    case "绑定":
    case "bind":
      if (!rest) throw new PenglaiError("INVALID_INPUT", "bind requires token");
      return { type: "bind", token: rest.split(/\s+/u)[0]! };
    case "解绑":
    case "unbind":
      return { type: "unbind" };
    case "状态":
    case "status":
      return { type: "status" };
    case "模型":
    case "model":
      return rest ? { type: "models", pick: rest } : { type: "models" };
    case "项目":
    case "projects":
      return rest ? { type: "projects", pick: rest } : { type: "projects" };
    case "会话":
    case "sessions":
      return rest ? { type: "sessions", pick: rest } : { type: "sessions" };
    case "新建":
    case "新对话":
    case "new":
    case "newchat":
    case "new_conversation":
      return { type: "new_session", title: rest || "im-session" };
    case "插话":
    case "steer":
      if (!rest) throw new PenglaiError("INVALID_INPUT", "steer requires text");
      return { type: "steer", text: rest };
    case "停止当前":
    case "停止":
    case "stop":
      return { type: "stop_current" };
    case "清空本聊天队列":
    case "clear":
      return { type: "clear_queue" };
    case "重置":
    case "reset":
      return { type: "unbind" };
    case "资料":
    case "context":
      return { type: "context_status" };
    case "记忆":
    case "memory":
      return { type: "memory_status" };
    case "预算":
    case "budget":
      return { type: "budget_status" };
    case "陪伴":
    case "companion":
      return { type: "companion_status" };
    case "语音":
    case "voice": {
      const mode = rest.toLowerCase();
      if (!mode || mode === "状态" || mode === "status") return { type: "voice_status" };
      if (mode === "文字" || mode === "text") return { type: "voice_reply_mode", mode: "text" };
      if (mode === "语音" || mode === "voice") return { type: "voice_reply_mode", mode: "voice" };
      if (mode === "跟随" || mode === "mirror") return { type: "voice_reply_mode", mode: "mirror-input" };
      if (mode === "同时" || mode === "both") return { type: "voice_reply_mode", mode: "text-and-voice" };
      throw new PenglaiError("INVALID_INPUT", "voice mode must be text, voice, mirror, or both");
    }
    case "版本":
    case "version":
      return { type: "version" };
    case "声音":
    case "voiceid":
      if (!rest) return { type: "voice_id" };
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(rest)) {
        throw new PenglaiError("INVALID_INPUT", "voice id rejected");
      }
      return { type: "voice_id", voiceId: rest };
    default:
      throw new PenglaiError("INVALID_INPUT", `unknown command /${name}`);
  }
}

export function helpText(authorized: boolean, locale: MenuLocale = "zh"): string {
  return formatNumberedHelp(authorized, locale);
}

export function welcomeMenuText(locale: MenuLocale = "zh"): string {
  if (locale === "en") {
    return ["Hi, I am Penglai.", "Send a message to talk.", "", helpText(true, "en")].join("\n");
  }
  return ["你好，我是蓬莱。", "直接发消息即可对话。", "", helpText(true, "zh")].join("\n");
}

export const KNOWN_COMMANDS: readonly string[] = COMMANDS;

export function versionText(): string {
  return [
    "Penglai 0.5.7",
    "DSH 0.1.1-rc.2 dsh-v0.1.1-rc.2 b150a551b8d465e31e418e1b2eaf5e79bbb7d28e",
    "DSH-IM reference v3.0.0 unsigned tag 881491704e7bddecc1ce937d53071865489df3f7 peeled 40b5a46516b44e30fa90e084400a8c3d578214e9",
  ].join("\n");
}
