import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CLIENTS = ["plugin-center", "memory", "im", "asr", "moss-tts"] as const;

const strictCodec = /mode:\s*["']strict["'][\s\S]{0,180}?typeSymbol:/;
const legacySchemaCodec =
  /mode:\s*["']strict["'][\s\S]{0,180}?typeSymbol:[\s\S]{0,180}?\bschema\s*:/;
const alpha2CreateCodec =
  /mode:\s*["']strict["'][\s\S]{0,180}?typeSymbol:[\s\S]{0,180}?\bcreate\s*:/;

test("R63-CLIENT-TYPERT-001 first-party browser Remote codecs match DSH alpha.2", () => {
  const protocol = readFileSync(
    join(
      ROOT,
      "node_modules/@deepseek-ai/dsh-typert-protocol/lib/types/types.d.ts",
    ),
    "utf8",
  );
  assert.match(protocol, /readonly create: \(\) => TypertSchema/);
  assert.doesNotMatch(
    protocol,
    /readonly schema:\s*TypertSchema/,
    "the pinned alpha.2 protocol no longer accepts codec.schema",
  );

  for (const pkg of CLIENTS) {
    const source = readFileSync(join(ROOT, `packages/${pkg}/src/dsh-client.js`), "utf8");
    assert.match(source, strictCodec, `${pkg} must declare strict Remote codecs`);
    assert.match(
      source,
      alpha2CreateCodec,
      `${pkg} must lazily create the process-realm Typert schema`,
    );
    assert.doesNotMatch(
      source,
      legacySchemaCodec,
      `${pkg} must not use the pre-alpha.2 codec.schema shape`,
    );
  }
});
