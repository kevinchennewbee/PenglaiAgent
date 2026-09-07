import assert from "node:assert/strict";
import test from "node:test";
import { localeForMossVoiceId } from "./index.js";

test("MOSS voice ids select matching locale instead of defaulting English and Japanese to zh", () => {
  assert.equal(localeForMossVoiceId("moss-zh-default"), "zh");
  assert.equal(localeForMossVoiceId("moss-en-default"), "en");
  assert.equal(localeForMossVoiceId("moss-ja-soyo"), "ja");
  assert.equal(localeForMossVoiceId(""), "zh");
});
