import { createServer } from "node:http";

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

export async function waitForJson(url, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      last = `status ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await delay(200);
  }
  throw new Error(`cdp list timeout ${url} last=${last}`);
}

export async function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("cdp websocket timeout")), 15_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(event.error ?? new Error("cdp websocket error"));
    });
  });
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const waiter = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
    else waiter.resolve(msg.result);
  });
  const send = (method, params = {}, timeoutMs = 20_000) => {
    const id = nextId++;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`cdp timeout ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
    ws.send(JSON.stringify({ id, method, params }));
    return result;
  };
  const close = () => {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  };
  return { send, close, ws };
}

export async function attachPage(debugPort, timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  let last = "no targets";
  while (Date.now() < end) {
    try {
      const list = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`, 2_000);
      const targets = Array.isArray(list) ? list : [];
      const page =
        targets.find((t) => t.type === "page" && /127\.0\.0\.1|localhost/.test(String(t.url ?? ""))) ??
        targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl) ??
        targets.find((t) => t.webSocketDebuggerUrl && /127\.0\.0\.1|localhost/.test(String(t.url ?? "")));
      if (page?.webSocketDebuggerUrl) {
        const session = await connectCdp(page.webSocketDebuggerUrl);
        await session.send("Runtime.enable");
        await session.send("Page.enable");
        return { session, target: page };
      }
      last = JSON.stringify(targets.map((t) => ({ type: t.type, url: t.url }))).slice(0, 400);
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await delay(300);
  }
  throw new Error(`no CDP page target on ${debugPort}: ${last}`);
}

export async function evaluate(session, expression) {
  const result = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result?.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "evaluate failed";
    throw new Error(String(desc));
  }
  return result?.result?.value;
}

export async function waitEval(session, expression, pred, timeoutMs, intervalMs = 300) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      last = await evaluate(session, expression);
      if (pred(last)) return last;
    } catch (err) {
      last = { error: err instanceof Error ? err.message : String(err) };
    }
    await delay(intervalMs);
  }
  return last;
}

export async function captureShot(session, destPath) {
  const rec = await session.send("Page.captureScreenshot", { format: "png" });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(destPath, Buffer.from(String(rec.data ?? ""), "base64"));
  return destPath;
}
