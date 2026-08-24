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

const OFFICIAL_VENDOR_CONSOLES: ReadonlyArray<{ host: string; paths: readonly string[] }> = [
  { host: "open.feishu.cn", paths: ["/app", "/document"] },
  { host: "open.larksuite.com", paths: ["/app", "/document"] },
];

/** Official Feishu/Lark consoles only. New windows stay denied; main opens these in the OS browser. */
export function officialVendorConsoleDecision(url: string): "allow" | "deny" {
  try {
    const got = new URL(url);
    if (got.protocol !== "https:") return "deny";
    if (got.username || got.password) return "deny";
    if (got.port && got.port !== "443") return "deny";
    const rule = OFFICIAL_VENDOR_CONSOLES.find((item) => item.host === got.hostname);
    if (!rule) return "deny";
    const path = got.pathname || "/";
    return rule.paths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
      ? "allow"
      : "deny";
  } catch {
    return "deny";
  }
}

export function navigationDecision(
  url: string,
  allowedOrigin: string,
  recoveryUrl?: string,
  opts?: { wizardComplete?: boolean },
): "allow" | "deny" {
  try {
    const got = new URL(url);
    if (recoveryUrl && sameNavigationTarget(got, new URL(recoveryUrl))) return "allow";
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
