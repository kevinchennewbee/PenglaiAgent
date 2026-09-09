import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  UOS20_OLDWORLD_ADDONS,
  overlayUos20OldWorldAddons,
  assertUos20OldWorldAddonFiles,
  oldWorldAddonPath,
  sha256File,
} from "./uos20-oldworld-addons.mjs";

test("pinned UOS addon artifacts match independent review hashes", () => {
  for (const spec of Object.values(UOS20_OLDWORLD_ADDONS)) {
    const path = oldWorldAddonPath(spec.file);
    const digest = sha256File(path);
    assert.equal(digest, spec.sha256);
    const bytes = readFileSync(path);
    assert.equal(bytes.includes(Buffer.from("ld-linux-loongarch-lp64d.so.1")), false);
  }
});

test("overlay writes architecture builds into the DSH module layout", () => {
  const work = mkdtempSync(join(tmpdir(), "penglai-uos-overlay-"));
  try {
    mkdirSync(join(work, "sharp"), { recursive: true });
    writeFileSync(
      join(work, "sharp", "package.json"),
      JSON.stringify({ name: "sharp", version: "0.35.4" }),
    );
    mkdirSync(join(work, "node-pty"), { recursive: true });
    writeFileSync(
      join(work, "node-pty", "package.json"),
      JSON.stringify({ name: "node-pty", version: "1.0.0" }),
    );
    const hashes = overlayUos20OldWorldAddons(work);
    assert.equal(hashes.libvips, UOS20_OLDWORLD_ADDONS.libvips.sha256);
    assertUos20OldWorldAddonFiles(work);
    const koffiPkg = JSON.parse(
      readFileSync(join(work, "@koromix", "koffi-linux-loong64", "package.json"), "utf8"),
    );
    assert.equal(koffiPkg.name, "@koromix/koffi-linux-loong64");
    const vips = readFileSync(
      join(work, "sharp", "src", "build", "Release", "libvips-cpp.so.42.20.6"),
    );
    assert.equal(
      createHash("sha256").update(vips).digest("hex"),
      UOS20_OLDWORLD_ADDONS.libvips.sha256,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
