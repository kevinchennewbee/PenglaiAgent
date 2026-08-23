import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, writeFileSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { delay } from "./cdp.mjs";
import { finish } from "./exit-contract.mjs";
import {
  FAIL_CLOSED_DEADLINE_MS,
  RUNNER_FAULTS,
  evaluateLiveSample,
  probeLiveHttpWs,
  readProcessIdentity,
} from "./runner-live.mjs";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function writeJson(path, value) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temp, path);
}

function acceptKey(key) {
  return createHash("sha1").update(String(key) + WS_GUID).digest("base64");
}

export function startCertFixtureServer(opts = {}) {
  const control = {
    httpOk: opts.httpOk !== false,
    wsOk: opts.wsOk !== false,
  };
  const server = createServer((req, res) => {
    if (control.httpOk) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end('<!doctype html><html><body><div id="root"></div></body></html>');
      return;
    }
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("down");
  });
  server.on("upgrade", (req, socket) => {
    if (!control.wsOk || !req.headers["sec-websocket-key"]) {
      socket.destroy();
      return;
    }
    const accept = acceptKey(req.headers["sec-websocket-key"]);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
        accept +
        "\r\n\r\n",
    );
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        server,
        port,
        origin: `http://127.0.0.1:${port}`,
        control,
        close: () =>
          new Promise((done) => {
            try {
              server.closeAllConnections?.();
            } catch {
              /* */
            }
            const timer = setTimeout(done, 250);
            server.close(() => {
              clearTimeout(timer);
              done();
            });
          }),
      });
    });
    server.on("error", reject);
  });
}

export function spawnCertTarget(userData, extraArgs = []) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", ...extraArgs], {
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, PENGLAI_RUNNER_CERT_TARGET: "1" },
  });
  return child;
}

function spawnReusedTarget() {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 250); process.title = 'penglai-cert-reused'"], {
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, PENGLAI_RUNNER_CERT_TARGET: "reused" },
  });
}

export async function waitIdentity(pid, timeoutMs = 5_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const id = readProcessIdentity(pid);
    if (id) return id;
    await delay(50);
  }
  return null;
}

export async function runFailClosedCertification(opts = {}) {
  const command = opts.command ?? "test:soak:installed";
  const fault = String(opts.fault || process.env.PENGLAI_RUNNER_FAULT || "").trim();
  const started = Date.now();
  if (!RUNNER_FAULTS.includes(fault)) {
    finish("FAIL", {
      command,
      reason: `unknown runner fault ${fault || "(empty)"}`,
      allowed: RUNNER_FAULTS,
      elapsedMs: Date.now() - started,
    });
  }

  const userData = mkdtempSync(join(tmpdir(), "penglai-runner-cert-"));
  const healthFile = join(userData, "soak-health.json");
  const fixture = await startCertFixtureServer();
  let target = spawnCertTarget(userData);
  let reused = null;
  const expectedIdentity = await waitIdentity(target.pid);
  if (!expectedIdentity) {
    await cleanup();
    finish("FAIL", { command, fault, reason: "cert fixture target never appeared", elapsedMs: Date.now() - started });
  }

  const expected = {
    sourceSha: "aa".repeat(20),
    artifactSha: "11".repeat(32),
    target: "darwin-aarch64",
    heartbeatMaxAgeMs: fault === "stale-heartbeat" ? 400 : 20_000,
  };

  const baseHealth = () => ({
    at: new Date().toISOString(),
    pid: target.pid,
    dshPid: target.pid,
    url: fixture.origin + "/",
    http: { status: 200, ok: true, official: true },
    websocket: { opened: true },
    sourceSha: expected.sourceSha,
    installerSha256: expected.artifactSha,
    target: expected.target,
  });

  const writeHealth = (patch = {}) => {
    writeJson(healthFile, { ...baseHealth(), ...patch });
  };

  writeHealth();
  await delay(80);

  if (fault === "kill-target") {
    try {
      target.kill("SIGTERM");
    } catch {
      /* */
    }
    const goneDeadline = Date.now() + 3_000;
    while (Date.now() < goneDeadline && readProcessIdentity(target.pid)) await delay(50);
    writeHealth({
      at: new Date().toISOString(),
      pid: expectedIdentity.pid,
      dshPid: expectedIdentity.pid,
      http: { status: 200, ok: true, official: true },
      websocket: { opened: true },
    });
  } else if (fault === "stale-heartbeat") {
    writeHealth({ at: new Date(Date.now() - 120_000).toISOString() });
  } else if (fault === "http-down") {
    fixture.control.httpOk = false;
  } else if (fault === "ws-down") {
    fixture.control.wsOk = false;
  } else if (fault === "pid-reuse") {
    const oldPid = target.pid;
    try {
      target.kill("SIGTERM");
    } catch {
      /* */
    }
    const goneDeadline = Date.now() + 3_000;
    while (Date.now() < goneDeadline && readProcessIdentity(oldPid)) await delay(50);
    reused = spawnReusedTarget();
    const reusedId = await waitIdentity(reused.pid);
    writeHealth({
      at: new Date().toISOString(),
      pid: reused?.pid ?? oldPid,
      dshPid: reused?.pid ?? oldPid,
    });
    target = reused;
    if (reusedId && reusedId.pid === oldPid && reusedId.startedAt === expectedIdentity.startedAt) {
      // Extremely unlikely same start stamp; still treat command change below.
    }
  } else if (fault === "wrong-source") {
    writeHealth({ sourceSha: "bb".repeat(20) });
  } else if (fault === "wrong-artifact") {
    writeHealth({ installerSha256: "ff".repeat(32) });
  } else if (fault === "wrong-target") {
    writeHealth({ target: "win32-x86_64" });
  }

  let last = null;
  let stayedGreen = true;
  while (Date.now() - started < FAIL_CLOSED_DEADLINE_MS) {
    const health = existsSync(healthFile) ? JSON.parse(readFileSync(healthFile, "utf8")) : null;
    const observedPid = Number(health?.pid ?? target?.pid ?? 0);
    const observed = readProcessIdentity(observedPid);
    const live = await probeLiveHttpWs(fixture.origin, 800);
    last = evaluateLiveSample({
      now: Date.now(),
      health,
      observed,
      expectedIdentity,
      expected,
      liveHttpWs: live,
      declaredSourceSha: health?.sourceSha,
      declaredArtifactSha: health?.installerSha256,
      declaredTarget: health?.target,
    });
    if (!last.ok) {
      stayedGreen = false;
      await Promise.race([cleanup(), delay(500)]);
      finish("FAIL", {
        command,
        fault,
        verdict: "FAIL",
        reason: last.reason,
        reasons: last.reasons,
        stayedGreen: false,
        elapsedMs: Date.now() - started,
        healthPresent: Boolean(health),
        healthHttpOfficial: health?.http?.official === true,
        live,
      });
    }
    await delay(80);
  }

  await Promise.race([cleanup(), delay(500)]);
  finish("FAIL", {
    command,
    fault,
    verdict: "FAIL",
    reason: `certification stayed green on ${fault}`,
    reasons: last?.reasons ?? [],
    stayedGreen,
    elapsedMs: Date.now() - started,
  });

  async function cleanup() {
    try {
      target?.kill("SIGTERM");
    } catch {
      /* */
    }
    try {
      reused?.kill("SIGTERM");
    } catch {
      /* */
    }
    try {
      await fixture.close();
    } catch {
      /* */
    }
    rmSync(userData, { recursive: true, force: true });
  }
}
