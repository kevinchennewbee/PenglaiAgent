import { PenglaiError } from "@penglai/contracts";
import type { ChannelId } from "./registry.js";

export function parseSlackSecret(secret: string): { botToken: string; appToken: string } {
  const trimmed = secret.trim();
  let botToken = "";
  let appToken = "";
  if (trimmed.startsWith("{")) {
    let parsed: { botToken?: string; appToken?: string };
    try {
      parsed = JSON.parse(trimmed) as { botToken?: string; appToken?: string };
    } catch {
      throw new PenglaiError("INVALID_INPUT", "SLACK_APP_TOKEN_REQUIRED");
    }
    botToken = String(parsed.botToken ?? "").trim();
    appToken = String(parsed.appToken ?? "").trim();
  } else {
    for (const line of trimmed.split(/\n+/).map((row) => row.trim()).filter(Boolean)) {
      if (line.startsWith("xoxb-")) botToken = line;
      else if (line.startsWith("xapp-")) appToken = line;
      else if (!botToken) botToken = line;
      else if (!appToken) appToken = line;
    }
  }
  if (!botToken || !appToken) {
    throw new PenglaiError("INVALID_INPUT", "SLACK_APP_TOKEN_REQUIRED");
  }
  return { botToken, appToken };
}

export function serializeChannelSecret(id: ChannelId, secret: string): string {
  const trimmed = secret.trim();
  if (id === "slack") return JSON.stringify(parseSlackSecret(trimmed));
  if (trimmed.startsWith("{")) return trimmed;
  if (id === "telegram" || id === "discord") return JSON.stringify({ token: trimmed });
  const [first, second] = trimmed.split(/\n+/);
  if (id === "dingtalk") return JSON.stringify({ clientId: first, clientSecret: second ?? "" });
  if (id === "wecom") return JSON.stringify({ botId: first, secret: second ?? "" });
  if (id === "qq") return JSON.stringify({ appId: first, clientSecret: second ?? "" });
  return trimmed;
}
