import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { OwnerDialogPort, OwnerDialogRequest } from "./owner-broker.js";

const REQUEST_DIR = ["owner-broker", "dialog-requests"] as const;
const RESULT_DIR = ["owner-broker", "dialog-results"] as const;

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(tmp, path);
}

export function ownerDialogRequestPath(root: string, actionId: string): string {
  return join(root, ...REQUEST_DIR, `${actionId}.json`);
}

export function ownerDialogResultPath(root: string, actionId: string): string {
  return join(root, ...RESULT_DIR, `${actionId}.json`);
}

/** Plugin-host dialog port: wait for Electron Main to record an allow/deny. */
export function createHostOwnerDialog(
  root: string,
  opts?: { timeoutMs?: number; pollMs?: number },
): OwnerDialogPort {
  const timeoutMs = opts?.timeoutMs ?? 5 * 60 * 1000;
  const pollMs = opts?.pollMs ?? 50;
  return async (req) => {
    mkdirSync(join(root, ...REQUEST_DIR), { recursive: true, mode: 0o700 });
    writeJsonAtomic(ownerDialogRequestPath(root, req.actionId), {
      ...req,
      requestedAt: new Date().toISOString(),
    });
    const resultPath = ownerDialogResultPath(root, req.actionId);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (existsSync(resultPath)) {
        const raw = JSON.parse(readFileSync(resultPath, "utf8")) as { decision?: unknown };
        rmSync(ownerDialogRequestPath(root, req.actionId), { force: true });
        rmSync(resultPath, { force: true });
        return raw.decision === "approved" ? "approved" : "denied";
      }
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    }
    rmSync(ownerDialogRequestPath(root, req.actionId), { force: true });
    return "denied";
  };
}

export async function drainOwnerDialogRequests(root: string, dialog: OwnerDialogPort): Promise<number> {
  const dir = join(root, ...REQUEST_DIR);
  if (!existsSync(dir)) return 0;
  let handled = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || name.includes(".tmp")) continue;
    const path = join(dir, name);
    const raw = JSON.parse(readFileSync(path, "utf8")) as OwnerDialogRequest;
    if (!raw?.actionId || !raw.action || !raw.pluginId) continue;
    const decision = await dialog(raw);
    writeJsonAtomic(ownerDialogResultPath(root, raw.actionId), { decision });
    rmSync(path, { force: true });
    handled += 1;
  }
  return handled;
}
