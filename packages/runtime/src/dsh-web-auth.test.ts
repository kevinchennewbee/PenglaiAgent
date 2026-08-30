import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  DshWebOutputCapture,
  establishDshWebSession,
  parseDshWebLaunchUrl,
  redactDshLaunchTokens,
} from "./dsh-web-auth.js";

const OFFICIAL_HTML = '<!doctype html><div id="root"></div><script src="/assets/index.js"></script>';

async function listeningServer(
  handler: Parameters<typeof createServer>[0],
): Promise<{ origin: string; close(): Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    origin: `http://127.0.0.1:${address.port}/`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    },
  };
}

test("alpha launch URL parsing is exact and output capture never exposes a split token", () => {
  const token = "a".repeat(43);
  const capture = new DshWebOutputCapture(3080);
  assert.equal(capture.push("loader ready\ndsh web: http://127.0.0.1:3080/?to"), "loader ready\n");
  const safe = capture.push(`ken=${token} (LAN: http://192.168.1.2:3080/?token=${token})\n`);
  assert.equal(safe.includes(token), false);
  assert.match(safe, /token=\[redacted\]/);
  assert.equal(capture.launchUrl, `http://127.0.0.1:3080/?token=${token}`);
  capture.clearLaunchUrl();
  assert.equal(capture.launchUrl, undefined);
  assert.equal(redactDshLaunchTokens(`x?token=${token}`), "x?token=[redacted]");

  assert.equal(parseDshWebLaunchUrl(`dsh web: http://127.0.0.1:3081/?token=${token}`, 3080), undefined);
  assert.equal(parseDshWebLaunchUrl(`dsh web: http://localhost:3080/?token=${token}`, 3080), undefined);
  assert.equal(parseDshWebLaunchUrl(`dsh web: http://127.0.0.1:3080/?token=${token}&extra=1`, 3080), undefined);
  assert.equal(
    parseDshWebLaunchUrl(
      `dsh web: http://127.0.0.1:3080/?token=${token}${" \t".repeat(100_000)}(LAN: http://192.168.1.2/)`,
      3080,
    ),
    `http://127.0.0.1:3080/?token=${token}`,
  );
});

test("rc.2 open root establishes a session without inventing browser credentials", async () => {
  const fixture = await listeningServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" }).end(OFFICIAL_HTML);
  });
  try {
    const session = await establishDshWebSession({
      origin: fixture.origin,
      timeoutMs: 500,
      launchUrl: () => undefined,
    });
    assert.deepEqual(session, { mode: "open" });
  } finally {
    await fixture.close();
  }
});

test("alpha browser token is exchanged privately and the returned cookie proves official Web readiness", async () => {
  const token = "b".repeat(43);
  const cookie = `dsh-auth-${"c".repeat(43)}=v1.${"d".repeat(43)}.${"e".repeat(43)}`;
  let tokenRequests = 0;
  const fixture = await listeningServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://dsh.invalid");
    if (url.pathname === "/" && url.searchParams.get("token") === token) {
      tokenRequests += 1;
      res.writeHead(303, { location: "/", "set-cookie": `${cookie}; Path=/; HttpOnly; SameSite=Strict` }).end();
      return;
    }
    if (url.pathname === "/" && req.headers.cookie === cookie) {
      res.writeHead(200, { "content-type": "text/html" }).end(OFFICIAL_HTML);
      return;
    }
    res.writeHead(401, { "content-type": "text/plain" }).end("authentication required");
  });
  try {
    const port = Number(new URL(fixture.origin).port);
    const capture = new DshWebOutputCapture(port);
    const safe = capture.push(`dsh web: ${fixture.origin}?token=${token}\n`);
    assert.equal(safe.includes(token), false);
    const session = await establishDshWebSession({
      origin: fixture.origin,
      timeoutMs: 1_000,
      launchUrl: () => capture.launchUrl,
      existingCookie: `dsh-auth-${"c".repeat(43)}=stale`,
    });
    assert.deepEqual(session, { mode: "browser-cookie", cookie });
    assert.equal(tokenRequests, 1);
    assert.equal(JSON.stringify(session).includes(token), false);
  } finally {
    await fixture.close();
  }
});

test("alpha readiness fails closed when token exchange does not mint an accepted cookie", async () => {
  const token = "f".repeat(43);
  const fixture = await listeningServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://dsh.invalid");
    if (url.searchParams.get("token") === token) {
      res.writeHead(303, { location: "/" }).end();
      return;
    }
    res.writeHead(401).end("authentication required");
  });
  try {
    const port = Number(new URL(fixture.origin).port);
    await assert.rejects(
      establishDshWebSession({
        origin: fixture.origin,
        timeoutMs: 180,
        launchUrl: () => `http://127.0.0.1:${port}/?token=${token}`,
      }),
      /session unavailable HTTP 401/,
    );
  } finally {
    await fixture.close();
  }
});

test("alpha readiness never follows a launch URL for a different authority", async () => {
  let attackerRequests = 0;
  const origin = await listeningServer((_req, res) => res.writeHead(401).end("authentication required"));
  const attacker = await listeningServer((_req, res) => {
    attackerRequests += 1;
    res.writeHead(303, { location: "/", "set-cookie": "dsh-auth-attacker=stolen" }).end();
  });
  try {
    await assert.rejects(
      establishDshWebSession({
        origin: origin.origin,
        timeoutMs: 180,
        launchUrl: () => `${attacker.origin}?token=${"g".repeat(43)}`,
      }),
      /session unavailable HTTP 401/,
    );
    assert.equal(attackerRequests, 0);
  } finally {
    await attacker.close();
    await origin.close();
  }
});
