import { createServer } from "node:http";

const TOKEN = "penglai-usable-ok";

function writeSse(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(
    `data: ${JSON.stringify({
      id: "penglai-fixture",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant", content: TOKEN }, finish_reason: null }],
    })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({
      id: "penglai-fixture",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
    })}\n\n`,
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

function writeJson(res) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id: "penglai-fixture",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: TOKEN }, finish_reason: "stop" }],
    }),
  );
}

export function handleUsableLlm(req, res) {
  const url = String(req.url ?? "");
  if (req.method === "GET" && (url === "/health" || url === "/v1/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, fixture: true }));
    return;
  }
  if (req.method === "GET" && (url === "/v1/models" || url === "/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "penglai-fixture", object: "model" }] }));
    return;
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let stream = true;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (body.stream === false) stream = false;
    } catch {
      stream = true;
    }
    if (stream) writeSse(res);
    else writeJson(res);
  });
}

export function createUsableLlmServer() {
  const server = createServer(handleUsableLlm);
  return server;
}
