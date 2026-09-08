import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
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

function pngRaster(bytes) {
  const { width, height } = pngSize(bytes);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  assert.equal(bitDepth, 8);
  assert.ok(colorType === 2 || colorType === 6, `unsupported PNG color type ${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const idats = [];
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const len = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + len);
    if (type === "IDAT") idats.push(data);
    if (type === "IEND") break;
    offset += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idats));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let src = 0;
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = raw.subarray(src, src + stride);
    src += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    if (filter === 0) {
      row.copy(out);
    } else if (filter === 1) {
      for (let i = 0; i < stride; i += 1) {
        const left = i >= channels ? out[i - channels] : 0;
        out[i] = (row[i] + left) & 255;
      }
    } else if (filter === 2) {
      for (let i = 0; i < stride; i += 1) out[i] = (row[i] + prev[i]) & 255;
    } else if (filter === 3) {
      for (let i = 0; i < stride; i += 1) {
        const left = i >= channels ? out[i - channels] : 0;
        out[i] = (row[i] + Math.floor((left + prev[i]) / 2)) & 255;
      }
    } else if (filter === 4) {
      for (let i = 0; i < stride; i += 1) {
        const a = i >= channels ? out[i - channels] : 0;
        const b = prev[i];
        const c = i >= channels ? prev[i - channels] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        out[i] = (row[i] + pr) & 255;
      }
    } else {
      throw new Error(`unsupported PNG filter ${filter}`);
    }
    out.copy(prev);
  }
  return { width, height, channels, pixels };
}

function sampleMean(img, x0, y0, x1, y1) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * img.width + x) * img.channels;
      r += img.pixels[i];
      g += img.pixels[i + 1];
      b += img.pixels[i + 2];
      n += 1;
    }
  }
  return { r: r / n, g: g / n, b: b / n };
}

function relativeLuminance({ r, g, b }) {
  const lin = (channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
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
  assert.match(html, /#f6f1e8/);
  assert.match(html, /label-well-penglai/);
  assert.match(html, /label-well-apps/);
  const raster = pngRaster(png);
  const penglaiWell = relativeLuminance(sampleMean(raster, 90, 255, 230, 285));
  const appsWell = relativeLuminance(sampleMean(raster, 430, 255, 570, 285));
  const navyField = relativeLuminance(sampleMean(raster, 310, 200, 350, 230));
  assert.ok(penglaiWell > 0.7, `Penglai label well too dark: ${penglaiWell}`);
  assert.ok(appsWell > 0.7, `Applications label well too dark: ${appsWell}`);
  assert.ok(navyField < 0.08, `ink-sea field too light: ${navyField}`);
  const dmg = readFileSync(join(root, "scripts/build-local-dmg.mjs"), "utf8");
  assert.match(dmg, /packaging\/dmg-background\.png/);
  assert.match(dmg, /background picture of theViewOptions/);
  assert.match(dmg, /set position of item "Penglai.app"/);
  assert.match(dmg, /set position of item "Applications"/);
  assert.match(dmg, /pathbar visible of container window to false/);
  assert.match(dmg, /sidebar width of container window to 0/);
  assert.match(dmg, /text size of theViewOptions to 12/);
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
