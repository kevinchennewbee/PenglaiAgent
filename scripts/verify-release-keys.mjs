#!/usr/bin/env node
// Compare public key fingerprints only. Never print or copy private PEM.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";

const keysRoot = join(homedir(), "Library", "Application Support", "PenglaiReleaseKeys");
const backupRoot = join(homedir(), "Library", "Application Support", "PenglaiReleaseKeysBackup");
const { EMBEDDED_UPDATER_PUBLIC_KEY, EMBEDDED_PLUGIN_CATALOG_PUBLIC_KEY } = await import(
  pathToFileURL(join(ROOT, "packages/plugin-registry/src/embedded-keys.ts")).href
);

function readPublic(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

if (!existsSync(keysRoot)) {
  finish("BLOCKED", {
    command: "verify:release-keys",
    reason: "release key directory is not present on this host",
  });
}

const updater = readPublic(join(keysRoot, "updater-ed25519-public.json"));
const plugin = readPublic(join(keysRoot, "plugin-catalog-ed25519-public.json"));
if (!updater?.publicKeyHex || !plugin?.publicKeyHex) {
  finish("BLOCKED", { command: "verify:release-keys", reason: "public key files missing" });
}

const updaterMatch =
  updater.publicKeyHex === EMBEDDED_UPDATER_PUBLIC_KEY.publicKeyHex &&
  (updater.keyId === EMBEDDED_UPDATER_PUBLIC_KEY.keyId || updater.publicKeyHex.startsWith("d706"));
const pluginMatch =
  plugin.publicKeyHex === EMBEDDED_PLUGIN_CATALOG_PUBLIC_KEY.publicKeyHex &&
  (plugin.keyId === EMBEDDED_PLUGIN_CATALOG_PUBLIC_KEY.keyId || plugin.publicKeyHex.startsWith("43d0"));
if (!updaterMatch || !pluginMatch) {
  finish("FAIL", {
    command: "verify:release-keys",
    reason: "on-disk public keys do not match embedded 0.5.3 trust roots",
    updaterMatch,
    pluginMatch,
  });
}

const backup =
  existsSync(join(backupRoot, "updater-ed25519-public.json")) &&
  existsSync(join(backupRoot, "plugin-catalog-ed25519-public.json"));
if (!backup) {
  finish("INCOMPLETE", {
    command: "verify:release-keys",
    reason: "second offline public-key backup copy is missing",
    updaterKeyId: EMBEDDED_UPDATER_PUBLIC_KEY.keyId,
    pluginKeyId: EMBEDDED_PLUGIN_CATALOG_PUBLIC_KEY.keyId,
  });
}

finish("PASS", {
  command: "verify:release-keys",
  updaterKeyId: EMBEDDED_UPDATER_PUBLIC_KEY.keyId,
  pluginKeyId: EMBEDDED_PLUGIN_CATALOG_PUBLIC_KEY.keyId,
  backup: true,
});
