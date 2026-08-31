import { PenglaiError } from "@penglai/contracts";

const LOOPBACK_HOST = "127.0.0.1";
const LAUNCH_PREFIX = "dsh web: ";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const COOKIE_PATTERN = /^dsh-auth-[A-Za-z0-9_-]+=[A-Za-z0-9._-]+$/;
const MAX_PENDING_OUTPUT = 16_384;

export type DshWebAuthMode = "open" | "browser-cookie";

export interface DshWebSession {
  mode: DshWebAuthMode;
  cookie?: string;
}

export interface OfficialDshProbe {
  status: number;
  body: string;
  official: boolean;
}

export function isOfficialDshHtml(body: string): boolean {
  if (!body.includes('id="root"')) return false;
  if (body.includes("data-penglai-recovery")) return false;
  if (body.includes("This bootstrap page is not the product surface")) return false;
  return body.includes("__DSH_BOOT__") || body.includes("/assets/") || body.includes("dsh-web");
}

export function redactDshLaunchTokens(value: string): string {
  return value.replace(/([?&]token=)[^\s)&]+/gu, "$1[redacted]");
}

/**
 * Accept only the exact loopback launch URL shape emitted by DSH 0.1.2-alpha.2.
 * The optional LAN URL on the same line is deliberately ignored.
 */
export function parseDshWebLaunchUrl(line: string, expectedPort: number): string | undefined {
  const at = line.indexOf(LAUNCH_PREFIX);
  if (at === -1) return undefined;
  const emitted = line.slice(at + LAUNCH_PREFIX.length).trim();
  const lanMarker = emitted.indexOf("(LAN:");
  const candidate = (lanMarker === -1 ? emitted : emitted.slice(0, lanMarker)).trim();
  if (!candidate) return undefined;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== LOOPBACK_HOST ||
    Number(url.port) !== expectedPort ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.hash !== ""
  ) return undefined;
  const tokens = url.searchParams.getAll("token");
  const keys = [...url.searchParams.keys()];
  if (tokens.length !== 1 || keys.length !== 1 || keys[0] !== "token" || !TOKEN_PATTERN.test(tokens[0] ?? "")) {
    return undefined;
  }
  return url.href;
}

/**
 * Holds incomplete output until a full line exists, so a token split across
 * stdout chunks can never be appended to public supervisor diagnostics.
 */
export class DshWebOutputCapture {
  #pending = "";
  #launchUrl: string | undefined;

  constructor(private readonly expectedPort: number) {}

  get launchUrl(): string | undefined {
    return this.#launchUrl;
  }

  clearLaunchUrl(): void {
    this.#launchUrl = undefined;
  }

  push(chunk: string): string {
    this.#pending += chunk;
    let safe = "";
    while (true) {
      const newline = this.#pending.indexOf("\n");
      if (newline === -1) break;
      const line = this.#pending.slice(0, newline + 1);
      this.#pending = this.#pending.slice(newline + 1);
      this.#launchUrl ??= parseDshWebLaunchUrl(line, this.expectedPort);
      safe += redactDshLaunchTokens(line);
    }
    if (this.#pending.length > MAX_PENDING_OUTPUT) {
      this.#pending = "";
      safe += "[dsh output line omitted]\n";
    }
    return safe;
  }

  flush(): string {
    const safe = redactDshLaunchTokens(this.#pending);
    this.#launchUrl ??= parseDshWebLaunchUrl(this.#pending, this.expectedPort);
    this.#pending = "";
    return safe;
  }
}

export async function probeOfficialDsh(
  url: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
  cookie?: string,
): Promise<OfficialDshProbe> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, Math.max(1, Math.floor(timeoutMs)));
  timer.unref?.();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      ...(cookie ? { headers: { cookie } } : {}),
    });
    const body = await res.text();
    return { status: res.status, body, official: res.status === 200 && isOfficialDshHtml(body) };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}

function responseCookies(headers: Headers): string[] {
  const withNodeExtension = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withNodeExtension.getSetCookie === "function") return withNodeExtension.getSetCookie();
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function browserSessionCookie(headers: Headers): string | undefined {
  for (const header of responseCookies(headers)) {
    const pair = header.split(";", 1)[0]?.trim();
    if (pair && COOKIE_PATTERN.test(pair)) return pair;
  }
  return undefined;
}

async function exchangeLaunchToken(launchUrl: string, timeoutMs: number): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.floor(timeoutMs)));
  timer.unref?.();
  try {
    const response = await fetch(launchUrl, { redirect: "manual", signal: controller.signal });
    if (response.status !== 303 || response.headers.get("location") !== "/") return undefined;
    return browserSessionCookie(response.headers);
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/**
 * Establish the Web session without exposing the alpha launch token to the
 * renderer. rc.2 succeeds through its open root; alpha.1 exchanges the exact
 * stdout URL for an authority-bound cookie and proves that cookie on `/`.
 */
export async function establishDshWebSession(input: {
  origin: string;
  timeoutMs: number;
  launchUrl: () => string | undefined;
  existingCookie?: string;
}): Promise<DshWebSession> {
  const origin = new URL(input.origin);
  if (
    origin.protocol !== "http:" ||
    origin.hostname !== LOOPBACK_HOST ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) throw new PenglaiError("SECURITY_POLICY", "DSH Web origin must be an exact loopback root");

  const started = Date.now();
  let lastStatus = 0;
  let candidateCookie = input.existingCookie && COOKIE_PATTERN.test(input.existingCookie)
    ? input.existingCookie
    : undefined;
  let exchangedLaunchUrl: string | undefined;
  while (Date.now() - started < input.timeoutMs) {
    const remaining = Math.max(1, input.timeoutMs - (Date.now() - started));
    try {
      if (candidateCookie) {
        const authenticated = await probeOfficialDsh(origin.href, Math.min(1_000, remaining), undefined, candidateCookie);
        lastStatus = authenticated.status;
        if (authenticated.official) return { mode: "browser-cookie", cookie: candidateCookie };
        candidateCookie = undefined;
      }

      const open = await probeOfficialDsh(origin.href, Math.min(1_000, remaining));
      lastStatus = open.status;
      if (open.official) return { mode: "open" };

      const announced = input.launchUrl();
      const launchUrl = announced
        ? parseDshWebLaunchUrl(`${LAUNCH_PREFIX}${announced}`, Number(origin.port))
        : undefined;
      if (launchUrl && new URL(launchUrl).origin === origin.origin && launchUrl !== exchangedLaunchUrl) {
        exchangedLaunchUrl = launchUrl;
        const exchangeRemaining = Math.max(1, input.timeoutMs - (Date.now() - started));
        candidateCookie = await exchangeLaunchToken(launchUrl, Math.min(1_000, exchangeRemaining));
      }
    } catch {
      // Startup is intentionally polled: the listener can bind before the
      // complete Loader tree and browser-auth owner are ready.
    }
    await delay(50);
  }
  throw new PenglaiError("DSH_UNAVAILABLE", `official DSH Web session unavailable HTTP ${lastStatus}`);
}
