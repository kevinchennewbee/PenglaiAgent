import assert from "node:assert/strict";
import test from "node:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { runInNewContext, Script } from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("R2I-BRAND-010/011 overlay applies only on exact upstream hash", async () => {
  const { applyOverlayToRoot } = await import(
    pathToFileURL(join(root, "scripts/apply-overlay.mjs")).href
  );
  const dir = mkdtempSync(join(tmpdir(), "penglai-overlay-"));
  const htmlRel = "node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html";
  const welcomeRel =
    "node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js";
  const heroRel =
    "node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js";
  const settingsRel =
    "node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js";
  mkdirSync(join(dir, dirname(htmlRel)), { recursive: true });
  mkdirSync(join(dir, dirname(welcomeRel)), { recursive: true });
  mkdirSync(join(dir, dirname(heroRel)), { recursive: true });
  mkdirSync(join(dir, dirname(settingsRel)), { recursive: true });
  cpSync(
    join(root, "overlays/dsh-0.1.1-rc.2/upstream/dsh-web-frontend.index.html"),
    join(dir, htmlRel),
  );
  cpSync(
    join(
      root,
      "overlays/dsh-0.1.1-rc.2/upstream/dsh-client-ui-settings-models.client.js",
    ),
    join(dir, welcomeRel),
  );
  cpSync(
    join(
      root,
      "overlays/dsh-0.1.1-rc.2/upstream/dsh-client-ui-conversation.client.js",
    ),
    join(dir, heroRel),
  );
  cpSync(
    join(
      root,
      "overlays/dsh-0.1.1-rc.2/upstream/dsh-client-ui-settings-general.client.js",
    ),
    join(dir, settingsRel),
  );
  const out = applyOverlayToRoot(dir);
  assert.equal(
    out.applied.every((r) => r.status === "applied"),
    true,
  );
  assert.equal(out.applied.length, 4);
  assert.match(
    readFileSync(join(dir, htmlRel), "utf8"),
    /<title>蓬莱 Penglai<\/title>/,
  );
  assert.match(
    readFileSync(join(dir, htmlRel), "utf8"),
    /penglai-brand\/title\.js/,
  );
  const welcomeSource = readFileSync(join(dir, welcomeRel), "utf8");
  assert.match(welcomeSource, /penglai-0\.5\.6\.0/);
  assert.match(welcomeSource, /欢迎使用蓬莱 0\.5\.6/);
  assert.match(welcomeSource, /Welcome to Penglai 0\.5\.6/);
  assert.doesNotMatch(
    welcomeSource,
    /欢迎使用蓬莱 0\.5\.[1235]|Welcome to Penglai 0\.5\.[1235]/,
  );
  const hero = readFileSync(join(dir, heroRel), "utf8");
  assert.doesNotThrow(() => new Script(hero));
  assert.match(hero, /conversation\.hero\.brand\.mark/);
  assert.doesNotMatch(hero, /data-penglai-hero-wordmark/);
  assert.match(hero, /ink-wash-light/);
  assert.match(hero, /ink-wash-dark/);
  assert.match(hero, /你好，我是蓬莱/);
  assert.match(hero, /Hi, I am Penglai/);
  assert.doesNotMatch(hero, /探索未至之境/);
  assert.doesNotMatch(hero, /Into the Unknown/);
  assert.match(
    hero,
    /renderSlot\("conversation\.chat\.assistant-actions", \{ messageId, text: assistantText\(closing\.blocks\) \}\)/,
  );
  assert.doesNotMatch(
    hero,
    /renderSlot\("conversation\.chat\.assistant-actions", \{ messageId \}\)/,
  );
  assert.match(hero, /data-penglai-im-voice/);
  assert.match(hero, /penglaiVisibleVoiceContent/);
  assert.match(hero, /PENGLAI LOCAL ASR METADATA - NOT USER-AUTHORED/);
  assert.match(hero, /return content\.slice\(1\)/);
  const settings = readFileSync(join(dir, settingsRel), "utf8");
  assert.doesNotThrow(() => new Script(welcomeSource));
  assert.doesNotThrow(() => new Script(settings));
  assert.match(settings, /data-settings-parent/);
  assert.match(settings, /isPenglaiChild/);
  assert.match(settings, /entry\.id\.startsWith\("penglai-"\)/);
  assert.match(settings, /navChildren/);
  const brandDir = join(
    dir,
    "node_modules/@deepseek-ai/dsh-web-frontend/dist/penglai-brand",
  );
  assert.equal(existsSync(join(brandDir, "logo-256.png")), true);
  assert.equal(existsSync(join(brandDir, "ink-wash-light.jpg")), true);
  assert.equal(existsSync(join(brandDir, "ink-wash-dark.jpg")), true);
  assert.equal(existsSync(join(brandDir, "title.js")), true);
  assert.match(
    readFileSync(join(brandDir, "title.js"), "utf8"),
    /MutationObserver/,
  );
  let syncTitle = () => undefined;
  const document = { title: "DeepSeek Harness", head: {} };
  runInNewContext(readFileSync(join(brandDir, "title.js"), "utf8"), {
    document,
    MutationObserver: class {
      constructor(callback: () => void) {
        syncTitle = callback;
      }
      observe() {}
    },
  });
  assert.equal(document.title, "蓬莱 Penglai");
  document.title = "Fixture session — DeepSeek Harness";
  syncTitle();
  assert.equal(document.title, "Fixture session — 蓬莱 Penglai");
  const welcome = readFileSync(join(dir, welcomeRel), "utf8");
  assert.match(welcome, /欢迎使用蓬莱/);
  assert.match(welcome, /Welcome to Penglai/);
  assert.match(welcome, /penglai-0\.5\.6\.0/);
  assert.match(welcome, /YAML/);
  assert.doesNotMatch(welcome, /内测声明/);
  assert.doesNotMatch(welcome, /official DSH Web/);
  assert.match(welcome, /community-verified/);
  assert.match(welcome, /not notarized/);
  const again = applyOverlayToRoot(dir);
  assert.equal(
    again.applied.every((r) => r.status === "already-applied"),
    true,
  );
  writeFileSync(join(dir, htmlRel), "<html>mutated</html>");
  assert.throws(() => applyOverlayToRoot(dir), /hash mismatch/);
});

test("overlay brand assets fail closed on checksum drift", async () => {
  const { applyBrandAssets, loadOverlayManifest } = await import(
    pathToFileURL(join(root, "scripts/apply-overlay.mjs")).href
  );
  const dir = mkdtempSync(join(tmpdir(), "penglai-brand-"));
  const overlayDir = mkdtempSync(join(tmpdir(), "penglai-overlay-brand-"));
  mkdirSync(join(overlayDir, "brand"), { recursive: true });
  const { dir: realOverlay, manifest } = loadOverlayManifest();
  writeFileSync(join(overlayDir, "manifest.json"), JSON.stringify(manifest));
  for (const row of manifest.brand) {
    cpSync(
      join(realOverlay, "brand", row.name),
      join(overlayDir, "brand", row.name),
    );
  }
  writeFileSync(join(overlayDir, "brand", "logo-256.png"), "tampered-logo");
  assert.throws(
    () => applyBrandAssets(dir, overlayDir),
    /overlay brand hash mismatch logo-256.png/,
  );
});
