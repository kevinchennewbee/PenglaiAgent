import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allowedTestCleanupNames, classifyUninstallResidue } from "./windows-uninstall-residue.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("uninstall PASS requires payload absence before deleting Uninstall.exe", () => {
  const leftoverUninstaller = classifyUninstallResidue(["Uninstall.exe"]);
  assert.equal(leftoverUninstaller.payloadRemoved, true);
  assert.equal(leftoverUninstaller.uninstallRemovedApp, true);
  assert.deepEqual(allowedTestCleanupNames(leftoverUninstaller), ["Uninstall.exe"]);

  const mixed = classifyUninstallResidue(["Uninstall.exe", "Penglai.exe", "resources/app.asar"]);
  assert.equal(mixed.payloadRemoved, false);
  assert.equal(mixed.uninstallRemovedApp, false);
  assert.deepEqual(allowedTestCleanupNames(mixed), []);
  assert.ok(mixed.payload.includes("Penglai.exe"));
});

test("PASS leftover names include Uninstall.exe and leftover symlinks", () => {
  const linked = classifyUninstallResidue(["Uninstall.exe", "payload.lnk"]);
  assert.equal(linked.payloadRemoved, false);
  assert.ok(linked.payload.includes("payload.lnk"));
  const onlyUninstaller = classifyUninstallResidue(["Uninstall.exe", "uninstall.log"]);
  assert.equal(onlyUninstaller.payloadRemoved, true);
  assert.deepEqual(onlyUninstaller.uninstallerOnly.sort(), ["Uninstall.exe", "uninstall.log"]);
  const upgrade = readFileSync(join(root, "scripts/verify-upgrade-uninstall.mjs"), "utf8");
  assert.match(upgrade, /uninstallLeftoverNames/);
  assert.match(upgrade, /leftover: uninstallLeftoverNames/);
});

test("upgrade-uninstall evidence must not delete the whole INSTDIR to manufacture PASS", () => {
  const upgrade = readFileSync(join(root, "scripts/verify-upgrade-uninstall.mjs"), "utf8");
  const helper = readFileSync(join(root, "scripts/lib/installed-app.mjs"), "utf8");
  assert.match(upgrade, /classifyUninstallResidue/);
  assert.doesNotMatch(upgrade, /removeTreeNoFollow\(app\)/);
  assert.match(helper, /classifyUninstallResidue/);
  const cleanup = helper.slice(helper.indexOf("export function cleanupRegisteredWindowsInstallerFixture"));
  assert.match(cleanup, /windowsFixtureUninstallFollowUp/);
  assert.match(cleanup, /removeTreeNoFollow\(installDir\)/);
  assert.match(upgrade, /uninstallLeftoverNames/);
});
