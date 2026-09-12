export const PRELOAD_API = [
  "getHealth",
  "createPairing",
  "listDiagnostics",
  "startWeixinQr",
  "exportPreview",
  "getUpdateStatus",
  "checkForUpdate",
  "downloadUpdate",
  "cancelUpdate",
  "confirmUpdate",
  "getStorageInventory",
  "prepareDataDeletion",
  "cancelDataDeletion",
  "executeDataDeletion",
  "getUninstallGuide",
  "wizardFinished",
  "wizardPickFolder",
  "pickContextFolder",
  "confirmPluginAction",
  "requestOwnerApproval",
  "beginMicrophoneRequest",
  "restartPluginRuntime",
  "openPluginLink",
  "recoveryRetry",
  "recoveryCopyDiagnostics",
  "recoveryOpenLogs",
  "recoveryOpenData",
  "recoveryQuit",
] as const;

export type PreloadApiName = (typeof PRELOAD_API)[number];

export function assertIpcName(name: string): boolean {
  return (PRELOAD_API as readonly string[]).includes(name);
}

function sameNavigationTarget(got: URL, expect: URL): boolean {
  if (got.protocol !== expect.protocol) return false;
  if (got.protocol === "file:") {
    return decodeURIComponent(got.pathname) === decodeURIComponent(expect.pathname);
  }
  if (got.hostname !== expect.hostname) return false;
  const gotPort = got.port || (got.protocol === "https:" ? "443" : "80");
  const expectPort = expect.port || (expect.protocol === "https:" ? "443" : "80");
  return gotPort === expectPort;
}

export function navigationDecision(
  url: string,
  allowedOrigin: string,
  recoveryUrl?: string,
  opts?: { wizardComplete?: boolean; extraFileUrls?: readonly string[] },
): "allow" | "deny" {
  try {
    const got = new URL(url);
    if (recoveryUrl && sameNavigationTarget(got, new URL(recoveryUrl))) return "allow";
    for (const extra of opts?.extraFileUrls ?? []) {
      if (sameNavigationTarget(got, new URL(extra))) return "allow";
    }
    const expect = new URL(allowedOrigin);
    if (!sameNavigationTarget(got, expect)) return "deny";
    if (opts?.wizardComplete && (got.pathname === "/wizard" || got.pathname.startsWith("/wizard/"))) {
      return "deny";
    }
    return "allow";
  } catch {
    return "deny";
  }
}
