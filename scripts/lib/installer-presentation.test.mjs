import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function pngSize(bytes) {
  assert.equal(bytes.subarray(0, 8).toString("binary"), "\u0089PNG\r\n\u001a\n");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function bmpInfo(bytes) {
  assert.equal(bytes.subarray(0, 2).toString("ascii"), "BM");
  return {
    width: bytes.readInt32LE(18),
    height: bytes.readInt32LE(22),
    bits: bytes.readUInt16LE(28),
    compression: bytes.readUInt32LE(30),
  };
}

test("macOS DMG background is the ink-sea bilingual drag card", () => {
  const png = readFileSync(join(root, "packaging/dmg-background.png"));
  assert.deepEqual(pngSize(png), { width: 660, height: 400 });
  const html = readFileSync(join(root, "packaging/installer-art/dmg.html"), "utf8");
  assert.match(html, /将蓬莱拖到应用程序/);
  assert.match(html, /Drag Penglai to Applications/);
  assert.match(html, /#0b1c2c/);
  const dmg = readFileSync(join(root, "scripts/build-local-dmg.mjs"), "utf8");
  assert.match(dmg, /packaging\/dmg-background\.png/);
  assert.match(dmg, /background picture of theViewOptions/);
  assert.match(dmg, /set position of item "Penglai.app"/);
  assert.match(dmg, /set position of item "Applications"/);
  assert.match(dmg, /"UDRW"/);
  assert.match(dmg, /"UDZO"/);
  assert.match(dmg, /hdiutilConvertArgs/);
  assert.match(dmg, /hdiutilCreateArgs/);
  assert.match(dmg, /mounted DMG missing branded background/);
  assert.doesNotMatch(dmg, /\/IM Penglai\.exe/);
});

test("Windows NSIS welcome and header bitmaps are 24-bit branded pages", () => {
  const welcome = bmpInfo(readFileSync(join(root, "packaging/nsis-welcome.bmp")));
  const header = bmpInfo(readFileSync(join(root, "packaging/nsis-header.bmp")));
  assert.deepEqual(welcome, { width: 164, height: 314, bits: 24, compression: 0 });
  assert.deepEqual(header, { width: 150, height: 57, bits: 24, compression: 0 });
  const welcomeHtml = readFileSync(join(root, "packaging/installer-art/nsis-welcome.html"), "utf8");
  const headerHtml = readFileSync(join(root, "packaging/installer-art/nsis-header.html"), "utf8");
  assert.match(welcomeHtml, />蓬莱</);
  assert.match(welcomeHtml, />Penglai</);
  assert.match(headerHtml, />蓬莱</);
  const nsi = readFileSync(join(root, "scripts/nsis/Penglai.nsi"), "utf8");
  const packager = readFileSync(join(root, "scripts/package-windows-nsis.mjs"), "utf8");
  assert.match(nsi, /MUI_WELCOMEFINISHPAGE_BITMAP/);
  assert.match(nsi, /MUI_HEADERIMAGE_BITMAP/);
  assert.match(nsi, /PenglaiStopScoped/);
  assert.match(nsi, /penglai-stop-scoped\.ps1/);
  assert.match(nsi, /GetFullPath\('\$INSTDIR'\)/);
  assert.doesNotMatch(nsi, /GetFullPath\(''\$INSTDIR''\)/);
  assert.doesNotMatch(nsi, /\/IM Penglai\.exe/);
  assert.match(packager, /PENGLAI_WELCOME_BMP=/);
  assert.match(packager, /PENGLAI_HEADER_BMP=/);
  assert.match(packager, /packaging", "nsis-welcome\.bmp"/);
});
