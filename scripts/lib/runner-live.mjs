import { spawnSync } from "node:child_process";

export const FAIL_CLOSED_DEADLINE_MS = 30_000;
export const HEARTBEAT_MAX_AGE_MS = 20_000;

export const RUNNER_FAULTS = Object.freeze([
  "kill-target",
  "stale-heartbeat",
  "http-down",
  "ws-down",
  "pid-reuse",
  "wrong-source",
  "wrong-artifact",
  "wrong-target",
]);

export function parseProcessIdentityLine(line) {
  const text = String(line ?? "").trim();
  if (!text) return null;
  const m = text.match(/^(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/);
  if (m) {
    return { pid: Number(m[1]), startedAt: m[2], command: m[3] };
  }
  const parts = text.split(/\s+/);
  const pid = Number(parts[0]);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  return {
    pid,
    startedAt: parts.slice(1, 6).join(" "),
    command: parts.slice(6).join(" "),
  };
}

export function readProcessIdentity(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (process.platform === "win32") {
    const command = [
      `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${Math.trunc(n)}' -ErrorAction SilentlyContinue`,
      "if ($null -ne $p) {",
      "[pscustomobject]@{pid=[int]$p.ProcessId;startedAt=$p.CreationDate.ToUniversalTime().ToString('o');command=[string]$p.CommandLine} | ConvertTo-Json -Compress",
      "}",
    ].join("; ");
    const r = spawnSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", windowsHide: true, timeout: 5_000 },
    );
    if (r.status !== 0 || !String(r.stdout ?? "").trim()) return null;
    try {
      const parsed = JSON.parse(String(r.stdout).trim());
      if (Number(parsed.pid) !== Math.trunc(n) || !parsed.startedAt) return null;
      return { pid: Number(parsed.pid), startedAt: String(parsed.startedAt), command: String(parsed.command ?? "") };
    } catch {
      return null;
    }
  }
  const r = spawnSync("/bin/ps", ["-p", String(n), "-o", "pid=,lstart=,command="], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return parseProcessIdentityLine(r.stdout);
}

export function identityMatches(observed, expected) {
  if (!observed || !expected) return false;
  return (
    Number(observed.pid) === Number(expected.pid) &&
    String(observed.startedAt) === String(expected.startedAt) &&
    String(observed.command) === String(expected.command)
  );
}

export function heartbeatAgeMs(health, now = Date.now()) {
  const raw = health?.at ?? health?.writtenAt ?? health?.ts;
  const ts = typeof raw === "number" ? raw : Date.parse(String(raw ?? ""));
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - ts);
}

export async function probeLiveHttpWs(origin, timeoutMs = 2_500) {
  const base = String(origin ?? "").replace(/\/$/, "");
  let httpOfficial = false;
  let httpStatus = 0;
  let wsOpened = false;
  if (!/^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(base) && !/^https?:\/\/localhost(?::\d+)?$/i.test(base)) {
    return { httpOfficial: false, httpStatus: 0, wsOpened: false, reason: "origin-not-loopback" };
  }
  try {
    const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(timeoutMs) });
    httpStatus = res.status;
    const body = await res.text();
    httpOfficial = Boolean(res.ok && body.includes('id="root"') && !body.includes("data-penglai-recovery"));
  } catch {
    httpOfficial = false;
  }
  try {
    wsOpened = await new Promise((resolve) => {
      const url = `${base.replace(/^http/i, "ws")}/api/remote.mux`;
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
          try {
            ws.close();
          } catch {
            /* */
          }
          done(false);
        }, timeoutMs);
        ws.addEventListener("open", () => {
          clearTimeout(timer);
          try {
            ws.close();
          } catch {
            /* */
          }
          done(true);
        });
        ws.addEventListener("error", () => {
          clearTimeout(timer);
          done(false);
        });
      } catch {
        done(false);
      }
    });
  } catch {
    wsOpened = false;
  }
  return { httpOfficial, httpStatus, wsOpened };
}

export function evaluateLiveSample(input = {}) {
  const now = Number(input.now ?? Date.now());
  const health = input.health && typeof input.health === "object" ? input.health : null;
  const expected = input.expected && typeof input.expected === "object" ? input.expected : {};
  const observed = input.observed ?? null;
  const expectedIdentity = input.expectedIdentity ?? null;
  const live = input.liveHttpWs && typeof input.liveHttpWs === "object" ? input.liveHttpWs : {};
  const maxAge = Number(expected.heartbeatMaxAgeMs ?? HEARTBEAT_MAX_AGE_MS);
  const reasons = [];

  const healthSource = health?.sourceSha ?? health?.candidateSourceSha;
  if (expected.sourceSha && healthSource && healthSource !== expected.sourceSha) reasons.push("wrong-source");
  if (expected.sourceSha && input.declaredSourceSha && input.declaredSourceSha !== expected.sourceSha) {
    if (!reasons.includes("wrong-source")) reasons.push("wrong-source");
  }

  const healthArtifact = health?.installerSha256 ?? health?.artifactSha ?? health?.artifactSha256;
  if (expected.artifactSha && healthArtifact && healthArtifact !== expected.artifactSha) reasons.push("wrong-artifact");
  if (expected.artifactSha && input.declaredArtifactSha && input.declaredArtifactSha !== expected.artifactSha) {
    if (!reasons.includes("wrong-artifact")) reasons.push("wrong-artifact");
  }

  const healthTarget = health?.target ?? health?.targetKey;
  if (expected.target && healthTarget && healthTarget !== expected.target) reasons.push("wrong-target");
  if (expected.target && input.declaredTarget && input.declaredTarget !== expected.target) {
    if (!reasons.includes("wrong-target")) reasons.push("wrong-target");
  }

  const targetPid = Number(expectedIdentity?.pid ?? health?.pid ?? health?.electronPid ?? 0);
  const alive = Boolean(observed?.pid);
  if (!alive || !targetPid) reasons.push("kill-target");

  if (alive && expectedIdentity && !identityMatches(observed, expectedIdentity)) {
    reasons.push("pid-reuse");
  }

  if (!health || heartbeatAgeMs(health, now) > maxAge) reasons.push("stale-heartbeat");

  const requireOfficialLive = input.requireOfficialLive !== false;
  if (requireOfficialLive) {
    if (live.httpOfficial !== true) reasons.push("http-down");
    if (live.wsOpened !== true) reasons.push("ws-down");
  }

  const unique = [...new Set(reasons)];
  return {
    ok: unique.length === 0,
    verdict: unique.length === 0 ? "PASS" : "FAIL",
    reasons: unique,
    reason: unique[0] ?? "",
    now,
    heartbeatAgeMs: health ? heartbeatAgeMs(health, now) : Number.POSITIVE_INFINITY,
  };
}

export function assertFailClosedWithinDeadline(startedAt, now = Date.now()) {
  return now - startedAt <= FAIL_CLOSED_DEADLINE_MS;
}
