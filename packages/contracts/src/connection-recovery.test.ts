import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..", "..", "..");
const connectionPackage = "@deepseek-ai/dsh-client-connection";
const pageClients = [
  "packages/office/src/dsh-client.js",
  "packages/memory/src/dsh-client.js",
  "packages/budget/src/dsh-client.js",
  "packages/companion/src/dsh-client.js",
  "packages/im/src/dsh-client.js",
] as const;

function source(relative: string): string {
  return readFileSync(join(root, relative), "utf8");
}

test("alpha.2 exposes generation loss and replacement through the official Slots hook seam", () => {
  const connectionTypes = source(
    "node_modules/@deepseek-ai/dsh-client-connection/lib/types/client/index.d.ts",
  );
  assert.match(
    connectionTypes,
    /getSnapshot\(\): ConnectionGeneration \| undefined;/,
  );
  assert.match(connectionTypes, /subscribe\(listener: \(\) => void\): \(\) => void;/);
  assert.match(
    connectionTypes,
    /readonly generation: ConnectionGenerationState;/,
  );

  const slotsTypes = source(
    "node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts",
  );
  assert.match(slotsTypes, /reserved `hooks` key/);
  assert.match(slotsTypes, /`use\$\{Capitalize<N>\}`/);
});

test("first-party stale pages bind the official generation hook and reload only while ready", () => {
  for (const relative of pageClients) {
    const client = source(relative);
    assert.match(client, /const inject = \["remote", "connection"\]/, relative);
    assert.match(client, /\["slots", "connection", "remote\.[^"]+"\]/, relative);
    assert.match(
      client,
      /hooks: \{\s*connectionGeneration: viewCtx\.connection\.generation,\s*\}/,
      relative,
    );
    assert.match(
      client,
      /useConnectionGeneration\(\s*\(generation\) => generation\?\.id,\s*\)/,
      relative,
    );
    assert.doesNotMatch(client, /React\.useSyncExternalStore/);
  }

  const office = source("packages/office/src/dsh-client.js");
  assert.match(office, /connectionGeneration === undefined/);
  assert.match(office, /let current = true;/);
  assert.equal((office.match(/if \(!current\) return;/g) ?? []).length, 2);

  for (const relative of [
    "packages/memory/src/dsh-client.js",
    "packages/context/src/dsh-client.js",
    "packages/budget/src/dsh-client.js",
    "packages/companion/src/dsh-client.js",
  ]) {
    const client = source(relative);
    assert.match(client, /const expectedGeneration = generationRef\.current;/, relative);
    assert.match(client, /expectedGeneration === undefined/, relative);
    assert.ok(
      (client.match(/generationRef\.current !== expectedGeneration/g) ?? [])
        .length >= 2,
      `${relative} must reject stale success and failure results`,
    );
    assert.match(client, /\[refresh, connectionGeneration\]/, relative);
  }

  const im = source("packages/im/src/dsh-client.js");
  assert.equal(
    (im.match(/const expectedGeneration = generationRef\.current;/g) ?? []).length,
    2,
  );
  assert.equal(
    (im.match(/\[(?:refresh|load), connectionGeneration\]/g) ?? []).length,
    2,
  );
  assert.ok(
    (im.match(/generationRef\.current !== expectedGeneration/g) ?? []).length >=
      3,
  );
});

test("source and packed plugin manifests load Connection before reconnect-aware pages", () => {
  const ids = ["office", "memory", "budget", "companion", "im"];
  for (const id of ids) {
    const manifest = JSON.parse(source(`packages/${id}/package.json`)) as {
      dsh?: { client?: { inject?: string[] } };
      dependencies?: Record<string, string>;
    };
    assert.ok(manifest.dsh?.client?.inject?.includes(connectionPackage), id);
    assert.equal(manifest.dependencies?.[connectionPackage], "0.1.2-rc.1", id);
  }

  const packer = source("scripts/pack-plugins.mjs");
  for (const id of ids) {
    const marker = `id: "@penglai/${id}"`;
    const start = packer.indexOf(marker);
    assert.ok(start >= 0, `${id} missing from packer`);
    const end = packer.indexOf("\n  {", start + marker.length);
    const block = packer.slice(start, end < 0 ? packer.length : end);
    assert.match(block, /"@deepseek-ai\/dsh-client-connection"/, id);
  }
});
