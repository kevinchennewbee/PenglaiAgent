import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { USER_CATALOG_PACKAGES } from "./pins.js";
import { assertParityLedger, assertSourcesDocPins, freezePins, MIGRATION_LEDGER, VOICE_NATIVE_BUBBLE } from "./freeze.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("F3 freeze pins match sources and voice compatibility docs", () => {
  const sources = readFileSync(join(root, "docs/sources.md"), "utf8");
  const voice = readFileSync(join(root, "docs/compatibility/VOICE_R3.md"), "utf8");
  const parity = readFileSync(join(root, "docs/compatibility/PENGLAI_041_PARITY_R3.md"), "utf8");
  assertSourcesDocPins(sources, voice);
  assertParityLedger(parity);
  const pins = freezePins();
  assert.equal(pins.dsh, "0.1.0-rc.8");
  assert.equal(pins.weixinRef, "2.4.6");
  assert.equal(pins.larkSdk, "1.73.0");
  assert.equal(pins.sherpa, "1.13.5");
  assert.equal(pins.onnxruntime, "1.27.0");
  assert.equal(pins.sentencepiece, "1.1.0");
  assert.equal(pins.mossRuntimeCommit, "c3b2333b88e0f062ca49d403540a169609354d93");
  assert.equal(pins.mossTtsModelRevision, "f52645cb467506d8e18e746ddd59482685b74e58");
  assert.equal(pins.mossCodecModelRevision, "ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae");
  assert.equal(pins.silk, "3.7.1");
  assert.equal(pins.libopus, "0.2.0");
  assert.equal(pins.libopusCommit, "55fe0b6faf9043518b7e1a7ea32e74659ecfbae7");
  assert.equal(VOICE_NATIVE_BUBBLE.weixin, "capability-probe-only");
  assert.equal(VOICE_NATIVE_BUBBLE.feishu, "official-audio-hard");
  assert.ok(USER_CATALOG_PACKAGES.includes("@penglai/asr"));
  assert.ok(USER_CATALOG_PACKAGES.includes("@penglai/companion"));
  assert.ok(MIGRATION_LEDGER.some((row) => row.capability === "0.4.1 Host/EpisodeRunner" && row.decision === "REJECT_DUPLICATE"));
  assert.doesNotMatch(readFileSync(join(root, "docs/PLATFORM_MATRIX.md"), "utf8"), /releases\/latest/);
});
