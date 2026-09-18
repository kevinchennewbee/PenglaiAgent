import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import { LlmRuntime } from "@deepseek-ai/dsh-llm";
import {
  cardsFromOfficialDirectory,
  wizardProviderCatalog,
} from "../../plugin-center/src/onboarding.js";
import { createPenglaiOnboardingRemoteImpl } from "../../plugin-center/src/onboarding-remote.js";
import { PINNED_DSH } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const requireHere = createRequire(join(here, "../package.json"));
const deepseekPkg = dirname(
  requireHere.resolve("@deepseek-ai/dsh-llm-deepseek/package.json"),
);
const deepseekLib = readFileSync(join(deepseekPkg, "lib/index.js"), "utf8");
const pkg = JSON.parse(
  readFileSync(join(deepseekPkg, "package.json"), "utf8"),
) as { version?: string };
const IMAGE_MODEL_ID = "deepseek-flash";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("official pinned dsh-llm-deepseek advertises its image-capable Flash model", () => {
  assert.equal(pkg.version, PINNED_DSH);
  assert.match(deepseekLib, /id:\s*"deepseek-flash"/);
  assert.match(deepseekLib, /name:\s*"DeepSeek-V41-Flash"/);
  assert.doesNotMatch(deepseekLib, /deepseek-v4-flash-vision-exp/);
  assert.match(deepseekLib, /inputModalities:\s*\[\s*"text",\s*"image"\s*\]/);
  assert.match(deepseekLib, /PROVIDER = "deepseek-official"/);
});

test("official adapter listModels exposes Flash with text,image modalities", async () => {
  const mod = (await import(
    pathToFileURL(join(deepseekPkg, "lib/index.js")).href
  )) as {
    DeepSeekAdapter: new (config: unknown) => {
      listModels(
        provider: string,
      ): Promise<
        Array<{ id: string; name?: string; inputModalities?: string[] }>
      >;
    };
    resolveAdapterOptions: (config: Record<string, unknown>) => unknown;
  };
  const adapter = new mod.DeepSeekAdapter({
    options: () => mod.resolveAdapterOptions({}),
    resolveApiKey: async () => "test-credential",
    resolveUserId: () => "vision-list",
  });
  const models = await adapter.listModels("deepseek-official");
  const flash = models.find((row) => row.id === "deepseek-flash");
  assert.ok(flash, "deepseek-flash missing from official adapter catalog");
  assert.equal(flash?.name, "DeepSeek-V41-Flash");
  assert.deepEqual(flash?.inputModalities, ["text", "image"]);
  assert.equal(
    models.some((row) => row.id === "deepseek-v4-flash-vision-exp"),
    false,
  );
});

test("official DeepSeek adapter serializes image attachments as Messages base64 sources", async () => {
  const mod = (await import(
    pathToFileURL(join(deepseekPkg, "lib/index.js")).href
  )) as {
    DeepSeekAdapter: new (config: unknown) => {
      stream(options: unknown): AsyncIterable<unknown>;
    };
    resolveAdapterOptions: (
      config: Record<string, unknown>,
    ) => Record<string, unknown>;
  };
  const captured: { url?: string; body?: string } = {};
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      if (String(req.url ?? "").startsWith("/files")) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "files unavailable" } }));
        return;
      }
      captured.url = req.url;
      captured.body = Buffer.concat(chunks).toString("utf8");
      res.writeHead(200, { "content-type": "text/event-stream" });
      const events = [
        {
          type: "message_start",
          message: { usage: { input_tokens: 8, output_tokens: 0 } },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "ok" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 1 },
        },
        { type: "message_stop" },
      ];
      for (const event of events) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseURL = `http://127.0.0.1:${address.port}`;
  const adapter = new mod.DeepSeekAdapter({
    options: () => ({ ...mod.resolveAdapterOptions({}), baseURL }),
    resolveApiKey: async () => "test-credential-penglai-vision-mock",
    resolveUserId: () => "penglai-vision-mock",
    prepareExtensions: async () => ({
      fields: Object.freeze(Object.create(null) as Record<string, unknown>),
      accept: async () => undefined,
    }),
    resolveAttachments: () => ({
      readImage: async (ref: { mediaType: string }) => ({ ref, data: PNG }),
      readImageRequest: async (ref: {
        attachmentId: string;
        mediaType?: string;
        width?: number;
        height?: number;
      }) => ({
        attachment: ref,
        variantId: `variant-${ref.attachmentId}`,
        mediaType: ref.mediaType ?? "image/png",
        data: PNG,
        bytes: PNG.length,
        width: ref.width ?? 1,
        height: ref.height ?? 1,
        hasAlpha: false,
      }),
    }),
  });
  const attachment = {
    attachmentId: "att-vision-fixture",
    mediaType: "image/png",
    bytes: PNG.length,
    width: 1,
    height: 1,
  };
  try {
    for await (const _chunk of adapter.stream({
      model: IMAGE_MODEL_ID,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what color" },
            { type: "image", attachment },
          ],
        },
      ],
    })) {
      void _chunk;
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
  assert.equal(captured.url, "/v1/messages");
  assert.ok(captured.body, "adapter did not POST a Messages body");
  const wire = JSON.parse(captured.body) as {
    model: string;
    messages: Array<{ role: string; content: unknown }>;
  };
  assert.equal(wire.model, IMAGE_MODEL_ID);
  const user = wire.messages.find((row) => row.role === "user");
  assert.ok(
    Array.isArray(user?.content),
    "image request must use multipart user content",
  );
  const parts = user?.content as Array<{
    type?: string;
    source?: { type?: string; media_type?: string; data?: string };
    text?: string;
  }>;
  assert.equal(
    parts.some(
      (part) =>
        part.type === "image" &&
        part.source?.type === "base64" &&
        part.source.media_type === "image/png" &&
        typeof part.source.data === "string" &&
        part.source.data.length > 0,
    ),
    true,
  );
  assert.equal(
    captured.body.includes("test-credential-penglai-vision-mock"),
    false,
  );
});

test("onboarding catalog surfaces deepseek-official so the vision model can be listed", () => {
  const ctx = new Context();
  const llm = new LlmRuntime(ctx);
  llm.registerConfigurableProviders([
    {
      provider: "deepseek-official",
      displayName: "DeepSeek Official",
      settingsNs: "llm-deepseek",
      settingsPath: ["providers", "deepseek-official"],
    },
  ]);
  const catalog = wizardProviderCatalog({
    listProviders: () => [{ id: "deepseek-official", name: "DeepSeek" }],
    listConfigurableProviders: () => llm.listConfigurableProviders(),
  });
  const cards = cardsFromOfficialDirectory(catalog);
  assert.equal(
    cards.some((card) => card.id === "deepseek-official"),
    true,
  );
});

test("onboarding selectModel saves the official image-capable Flash model", async () => {
  const userDataRoot = mkdtempSync(join(tmpdir(), "penglai-vision-onb-"));
  const dir = join(userDataRoot, "onboarding");
  mkdirSync(dir, { mode: 0o700 });
  const impl = createPenglaiOnboardingRemoteImpl({
    dir,
    userDataRoot,
    officialCatalog: () => ({
      providers: [{ id: "deepseek-official", protocol: "deepseek" }],
    }),
    officialWelcomeAck: () => true,
    agents: {
      settings: {
        mutate: async () => {},
        describe: () => [],
      },
      llm: {
        listProviders: () => [{ id: "deepseek-official", name: "DeepSeek" }],
        listModels: async (provider: string) => [
          { provider, id: IMAGE_MODEL_ID, name: "DeepSeek-V41-Flash" },
        ],
        resolveModelInfo: async (provider: string, model: string) => ({
          provider,
          id: model,
          name: model,
          inputModalities:
            model === IMAGE_MODEL_ID ? ["text", "image"] : ["text"],
        }),
      },
    },
  });
  impl.advance("appearance-locale-v1", { locale: "zh", theme: "system" });
  impl.advance("privacy-v1");
  await impl.selectModel({
    provider: "deepseek-official",
    model: IMAGE_MODEL_ID,
  });
  assert.deepEqual(impl.facts().selection, {
    provider: "deepseek-official",
    model: IMAGE_MODEL_ID,
  });
  assert.equal(impl.status().current, "credential-v1");
});
