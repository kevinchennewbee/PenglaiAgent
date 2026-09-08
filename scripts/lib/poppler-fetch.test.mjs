import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ROOT } from "./repo.mjs";
import {
  assertDarwinOtoolClean,
  assertSafeArchiveEntry,
  canonicalTreeListing,
  classifyWindowsDll,
  downloadHttps,
  extractCondaPkg,
  isTransientPopplerDownloadStatus,
  listZipEntriesFromBuffer,
  paddedPopplerDatadir,
  parseFetchArgs,
  parsePeImports,
  patchFontconfigXml,
  patchPopplerDatadir,
  publishedTreeDigest,
  rewriteMacBinary,
  rewriteThinMachO,
  stripThinMachOSignature,
  readZip64Sizes,
  readZipFile,
  rejectedShipName,
  selectAssets,
  verifyArchive,
  walkWindowsClosure,
} from "./poppler-fetch.mjs";
import { POPPLER_ASSETS, POPPLER_UPSTREAM, popplerAssetForTarget } from "./poppler-assets.mjs";

function storeZip(entries) {
  const locals = [];
  const cds = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const piece = Buffer.concat([local, nameBuf, data]);
    locals.push(piece);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    cds.push(Buffer.concat([cd, nameBuf]));
    offset += piece.length;
  }
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

test("fetch-poppler rejects unknown arguments", () => {
  assert.throws(() => parseFetchArgs(["--weird"]), /unknown fetch-poppler argument/);
});

test("fetch-poppler --host-only selects one host target", () => {
  const parsed = parseFetchArgs(["--host-only"]);
  const assets = selectAssets(parsed, "darwin", "arm64");
  assert.equal(assets.length, 1);
  assert.equal(assets[0].target, "darwin-aarch64");
});

test("fetch-poppler --all selects three conda 26.09.0 targets", () => {
  const assets = selectAssets(parseFetchArgs(["--all"]));
  assert.deepEqual(
    assets.map((row) => row.target),
    ["darwin-aarch64", "darwin-x86_64", "win32-x86_64"],
  );
  assert.equal(assets.length, POPPLER_ASSETS.length);
});

test("archive entries reject traversal and absolute paths", () => {
  assert.throws(() => assertSafeArchiveEntry("../etc/passwd"), /unsafe/);
  assert.throws(() => assertSafeArchiveEntry("/abs"), /unsafe/);
  assert.throws(() => assertSafeArchiveEntry("foo\0bar"), /unsafe/);
  assert.doesNotThrow(() => assertSafeArchiveEntry("pkg-poppler-26.09.0-hb6e6627_0.tar.zst"));
});

test("zip listing reads zip64 extra sizes used by some conda-forge packages", () => {
  const payload = Buffer.from("pkg-body");
  const extra = Buffer.alloc(20);
  extra.writeUInt16LE(1, 0);
  extra.writeUInt16LE(16, 2);
  extra.writeBigUInt64LE(BigInt(payload.length), 4);
  extra.writeBigUInt64LE(BigInt(payload.length), 12);
  const name = Buffer.from("pkg-graphite2-1.3.15-h2fb4741_1.tar.zst");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt32LE(0xffffffff, 18);
  local.writeUInt32LE(0xffffffff, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(extra.length, 28);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt32LE(0xffffffff, 20);
  cd.writeUInt32LE(0xffffffff, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt16LE(extra.length, 30);
  cd.writeUInt32LE(0, 42);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  const beforeCd = Buffer.concat([local, name, extra, payload]);
  eocd.writeUInt32LE(cd.length + name.length + extra.length, 12);
  eocd.writeUInt32LE(beforeCd.length, 16);
  const buf = Buffer.concat([beforeCd, cd, name, extra, eocd]);
  const entries = listZipEntriesFromBuffer(buf);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].comp, payload.length);
  assert.equal(entries[0].uncomp, payload.length);
  assert.equal(readZipFile(buf, entries[0]).equals(payload), true);
  assert.throws(() => readZip64Sizes(Buffer.alloc(0), 0xffffffff, 0xffffffff, 0), /zip64 extra missing/);
});

test("zip listing rejects unsafe conda members before extract", () => {
  const buf = storeZip([
    { name: "../pkg-evil.tar.zst", data: Buffer.from("nope") },
    { name: "metadata.json", data: Buffer.from("{}") },
  ]);
  const names = listZipEntriesFromBuffer(buf).map((e) => e.name);
  assert.ok(names.includes("../pkg-evil.tar.zst"));
  assert.throws(() => names.forEach(assertSafeArchiveEntry), /unsafe/);
});

test("verifyArchive fails closed on digest and size mismatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "poppler-verify-"));
  const path = join(dir, "x.conda");
  const body = Buffer.from("not-a-real-conda");
  writeFileSync(path, body);
  const sha = createHash("sha256").update(body).digest("hex");
  assert.throws(() => verifyArchive(path, "ab".repeat(32), body.length), /hash mismatch/);
  assert.throws(() => verifyArchive(path, sha, body.length + 1), /size mismatch/);
  const ok = verifyArchive(path, sha, body.length);
  assert.equal(ok.sha256, sha);
});

test("downloadHttps rejects hosts outside the Poppler allowlist", async () => {
  const dest = join(mkdtempSync(join(tmpdir(), "poppler-host-")), "x");
  await assert.rejects(
    () => downloadHttps("https://github.com/oschwartz10612/poppler-windows/x", dest),
    /host rejected/,
  );
  await assert.rejects(() => downloadHttps("http://conda.anaconda.org/x", dest), /host rejected/);
});

test("downloadHttps retries a transient 504 then writes the archive", async () => {
  let calls = 0;
  const dest = join(mkdtempSync(join(tmpdir(), "poppler-dl-")), "pkg.conda");
  const payload = Buffer.from("poppler-archive");
  const out = await downloadHttps("https://conda.anaconda.org/conda-forge/osx-arm64/x.conda", dest, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 504, headers: { get: () => null }, body: { cancel: async () => undefined } };
      }
      return { ok: true, status: 200, headers: { get: () => null }, body: Readable.toWeb(Readable.from(payload)) };
    },
    sleepImpl: async () => undefined,
  });
  assert.equal(calls, 2);
  assert.equal(readFileSync(out).toString(), "poppler-archive");
  assert.equal(isTransientPopplerDownloadStatus(504), true);
});

test("downloadHttps does not retry a 404", async () => {
  let calls = 0;
  const dest = join(mkdtempSync(join(tmpdir(), "poppler-404-")), "x");
  await assert.rejects(
    () =>
      downloadHttps("https://conda.anaconda.org/conda-forge/osx-arm64/missing.conda", dest, {
        fetchImpl: async () => {
          calls += 1;
          return { ok: false, status: 404, headers: { get: () => null }, body: { cancel: async () => undefined } };
        },
        sleepImpl: async () => {
          throw new Error("404 must not sleep-retry");
        },
      }),
    /download failed 404/,
  );
  assert.equal(calls, 1);
});

test("POPPLER_DATADIR slot is slash-padded to the compile-time memcpy length", () => {
  const prefix =
    "/Users/runner/miniforge3/conda-bld/poppler-split_1788834320096/_h_env_placehold_placehold_placehold/share/poppler";
  const buf = Buffer.concat([Buffer.from("AA\0"), Buffer.from(prefix), Buffer.from([0]), Buffer.from("BB")]);
  const out = patchPopplerDatadir(buf);
  assert.equal(out.length, buf.length);
  const start = 3;
  const end = out.indexOf(0, start);
  assert.equal(end - start, prefix.length);
  const slot = out.slice(start, end).toString("utf8");
  assert.equal(slot.startsWith("share/poppler/"), true);
  assert.equal(slot.replaceAll("/", ""), "sharepoppler");
  assert.equal(out.includes("_h_env_placehold"), false);
  assert.equal(out[end], 0);
  assert.equal(paddedPopplerDatadir(269).length, 269);
  assert.equal(paddedPopplerDatadir(269).includes(0), false);
});

test("fontconfig cachedir placeholder is rewritten to an XDG path", () => {
  const xml = `<fontconfig><cachedir>/Users/runner/miniforge3/conda-bld/fontconfig/_h_env_placehold/var/cache/fontconfig</cachedir><cachedir prefix="xdg">fontconfig</cachedir></fontconfig>`;
  const out = patchFontconfigXml(xml);
  assert.doesNotMatch(out, /miniforge|_h_env_placehold/);
  assert.match(out, /penglai-fontconfig/);
});

test("Windows PE classifier treats VC/UCRT as remaining and tiff.dll as bundled", () => {
  assert.equal(classifyWindowsDll("KERNEL32.dll"), "system");
  assert.equal(classifyWindowsDll("SHELL32.dll"), "system");
  assert.equal(classifyWindowsDll("ADVAPI32.dll"), "system");
  assert.equal(classifyWindowsDll("api-ms-win-crt-runtime-l1-1-0.dll"), "ucrt");
  assert.equal(classifyWindowsDll("VCRUNTIME140.dll"), "vcruntime");
  assert.equal(classifyWindowsDll("MSVCP140.dll"), "vcruntime");
  assert.equal(classifyWindowsDll("tiff.dll"), "bundle");
  assert.equal(classifyWindowsDll("icuuc78.dll"), "bundle");
  assert.equal(rejectedShipName("libpoppler-glib.8.dylib", "darwin-aarch64"), true);
  assert.equal(rejectedShipName("pdftocairo", "darwin-aarch64"), true);
  assert.equal(rejectedShipName("pdftoppm", "darwin-aarch64"), false);
  assert.equal(rejectedShipName("icuuc78.dll", "win32-x86_64"), false);
  assert.equal(rejectedShipName("icuin78.dll", "win32-x86_64"), true);
});

test("published-tree digest is a hash of the sorted path/sha256/bytes listing", () => {
  const dir = mkdtempSync(join(tmpdir(), "poppler-tree-"));
  mkdirSync(join(dir, "share"), { recursive: true });
  writeFileSync(join(dir, "pdftoppm"), "helper");
  writeFileSync(join(dir, "share", "a"), "data");
  writeFileSync(join(dir, "manifest.json"), "{}");
  const listing = canonicalTreeListing(dir);
  assert.match(listing, /^pdftoppm\t/);
  assert.doesNotMatch(listing, /manifest\.json/);
  const digest = publishedTreeDigest(dir);
  assert.equal(digest.length, 64);
  const again = publishedTreeDigest(dir);
  assert.equal(digest, again);
});

test("rewriteMacBinary is idempotent and does not grow a dylib ID to @loader_path", (t) => {
  const src = join(ROOT, "third_party/poppler/darwin-aarch64/libdeflate.0.dylib");
  if (process.platform !== "darwin" || !existsSync(src)) {
    t.skip("flattened darwin dylib not assembled");
    return;
  }
  const work = mkdtempSync(join(tmpdir(), "penglai-rewrite-mac-"));
  try {
    const copy = join(work, "libdeflate.0.dylib");
    cpSync(src, copy);
    rewriteMacBinary(copy, true);
    const first = readFileSync(copy);
    rewriteMacBinary(copy, true);
    assert.equal(readFileSync(copy).equals(first), true);
    assertDarwinOtoolClean(copy);
    const otool = spawnSync("otool", ["-L", copy], { encoding: "utf8" });
    assert.match(otool.stdout.split("\n")[1] || "", /libdeflate\.0\.dylib/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("rewriteMacBinary relocates raw conda Mach-Os without install_name_tool growth", (t) => {
  const fontconfigPkg = join(ROOT, "third_party/poppler/cache/fontconfig-2.18.3-h81aa574_1.conda");
  const popplerPkg = join(ROOT, "third_party/poppler/cache/poppler-26.09.0-hb6e6627_0.conda");
  if (process.platform !== "darwin" || !existsSync(fontconfigPkg) || !existsSync(popplerPkg)) {
    t.skip("raw conda cache missing for darwin-aarch64 fontconfig/poppler");
    return;
  }
  const work = mkdtempSync(join(tmpdir(), "penglai-raw-macho-"));
  try {
    const fontRoot = extractCondaPkg(fontconfigPkg, join(work, "fontconfig"));
    const popplerRoot = extractCondaPkg(popplerPkg, join(work, "poppler"));
    const fontconfig = join(fontRoot, "lib/libfontconfig.1.dylib");
    const pdftoppm = join(popplerRoot, "bin/pdftoppm");
    const libpoppler = join(popplerRoot, "lib/libpoppler.164.dylib");
    const fontCopy = join(work, "libfontconfig.1.dylib");
    const pdfCopy = join(work, "pdftoppm");
    const popCopy = join(work, "libpoppler.164.dylib");
    cpSync(fontconfig, fontCopy);
    cpSync(pdftoppm, pdfCopy);
    cpSync(libpoppler, popCopy);
    const signedFont = readFileSync(fontCopy);
    const strippedFont = stripThinMachOSignature(signedFont);
    assert.notEqual(strippedFont.length, signedFont.length);
    assert.equal(stripThinMachOSignature(strippedFont).equals(strippedFont), true);
    const rewrittenFont = rewriteThinMachO(strippedFont);
    assert.equal(rewriteThinMachO(rewrittenFont).equals(rewrittenFont), true);

    const beforeFont = spawnSync("otool", ["-L", fontCopy], { encoding: "utf8" }).stdout;
    assert.match(beforeFont, /@rpath\/libfreetype\.6\.dylib/);
    const beforePdf = spawnSync("otool", ["-l", pdfCopy], { encoding: "utf8" }).stdout;
    assert.match(beforePdf, /@loader_path\/\.\.\/lib/);
    const beforePop = spawnSync("otool", ["-L", popCopy], { encoding: "utf8" }).stdout;
    assert.match(beforePop, /@rpath\/libcurl\.4\.dylib/);
    assert.match(beforePop, /@rpath\/libz\.1\.dylib/);

    rewriteMacBinary(fontCopy, true);
    assert.equal(readFileSync(fontCopy).equals(rewrittenFont), true);
    rewriteMacBinary(pdfCopy, false);
    rewriteMacBinary(popCopy, true);
    assert.equal(readFileSync(fontCopy).length, rewrittenFont.length);
    assertDarwinOtoolClean(fontCopy);
    assertDarwinOtoolClean(pdfCopy);
    assertDarwinOtoolClean(popCopy);

    const fontAfter = spawnSync("otool", ["-L", fontCopy], { encoding: "utf8" }).stdout;
    assert.match(fontAfter, /@rpath\/libfreetype\.6\.dylib/);
    assert.doesNotMatch(fontAfter, /@loader_path\/libfreetype\.6\.dylib/);
    const pdfAfter = spawnSync("otool", ["-l", pdfCopy], { encoding: "utf8" }).stdout;
    assert.doesNotMatch(pdfAfter, /@loader_path\/\.\.\/lib/);
    assert.match(pdfAfter, /path @loader_path/);
    const pdfDeps = spawnSync("otool", ["-L", pdfCopy], { encoding: "utf8" }).stdout;
    assert.match(pdfDeps, /\/usr\/lib\/libc\+\+\.1\.dylib/);
    assert.match(pdfDeps, /@rpath\/libpoppler\.164\.dylib/);
    const popAfter = spawnSync("otool", ["-L", popCopy], { encoding: "utf8" }).stdout;
    assert.match(popAfter, /\/usr\/lib\/libcurl\.4\.dylib/);
    assert.match(popAfter, /\/usr\/lib\/libz\.1\.dylib/);
    assert.match(popAfter, /@rpath\/libfontconfig\.1\.dylib/);
    assert.equal(readFileSync(popCopy).length, stripThinMachOSignature(readFileSync(libpoppler)).length);

    const again = rewriteThinMachO(readFileSync(fontCopy));
    assert.equal(again.equals(readFileSync(fontCopy)), true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("assembled darwin-aarch64 tree is a conda 26.09.0 helper, not a Homebrew gpgme dump", (t) => {
  const dest = join(ROOT, "third_party/poppler/darwin-aarch64");
  if (!existsSync(join(dest, "pdftoppm"))) {
    t.skip("pinned conda pdftoppm not assembled");
    return;
  }
  assert.equal(existsSync(join(dest, "libpoppler.164.dylib")) || existsSync(join(dest, "libharfbuzz.0.dylib")), true);
  assert.equal(existsSync(join(dest, "libgpgme.45.dylib")), false);
  assert.equal(existsSync(join(dest, "libpoppler.163.dylib")), false);
  assert.equal(existsSync(join(dest, "share/poppler/cMap")), true);
  assert.equal(existsSync(join(dest, "fonts/fonts.conf")), true);
  const listing = readFileSync(join(dest, "fonts/fonts.conf"), "utf8");
  assert.doesNotMatch(listing, /miniforge|_h_env_placehold|\/opt\/homebrew/);
  const digest = publishedTreeDigest(dest);
  const pinned = popplerAssetForTarget("darwin-aarch64").publishedTreeSha256;
  if (pinned) assert.equal(digest, pinned);
  assertDarwinOtoolClean(join(dest, "pdftoppm"));
  const otool = readFileSync(join(dest, "pdftoppm"));
  assert.ok(otool.length > 0);
  const lib = readFileSync(join(dest, "libpoppler.164.dylib"));
  const slotAt = lib.indexOf(Buffer.from("share/poppler/"));
  assert.ok(slotAt >= 0);
  const slot = lib.subarray(slotAt, slotAt + 269);
  assert.equal(slot.length, 269);
  assert.equal(slot.includes(0), false);
  assert.equal(lib[slotAt + 269], 0);
  assert.equal(lib.includes(Buffer.from("_h_env_placehold")), false);
  const signed = spawnSync("codesign", ["--display", join(dest, "pdftoppm")], { encoding: "utf8" });
  assert.match(`${signed.stderr}${signed.stdout}`, /not signed|code object is not signed/i);
});

test("static otool of both darwin published trees has no Homebrew or ../lib rpath", (t) => {
  const missing = ["darwin-aarch64", "darwin-x86_64"].filter(
    (target) => !existsSync(join(ROOT, "third_party/poppler", target, "pdftoppm")),
  );
  if (missing.length) {
    t.skip(`pinned conda pdftoppm not assembled for ${missing.join(", ")}`);
    return;
  }
  for (const target of ["darwin-aarch64", "darwin-x86_64"]) {
    const dest = join(ROOT, "third_party/poppler", target);
    const names = readdirSync(dest).filter((n) => n === "pdftoppm" || n.endsWith(".dylib"));
    assert.ok(names.includes("pdftoppm"));
    assert.ok(names.some((n) => n.startsWith("libpoppler.164")));
    assert.ok(names.includes("libharfbuzz.0.dylib"));
    assert.ok(names.includes("libglib-2.0.0.dylib"));
    for (const name of names) assertDarwinOtoolClean(join(dest, name));
    const pinned = popplerAssetForTarget(target).publishedTreeSha256;
    if (pinned) assert.equal(publishedTreeDigest(dest), pinned);
  }
});

test("static Windows PE walk of published pdftoppm.exe closes without skipping DLLs", (t) => {
  const dest = join(ROOT, "third_party/poppler/win32-x86_64");
  const exe = join(dest, "pdftoppm.exe");
  if (!existsSync(exe)) {
    t.skip("pinned conda pdftoppm.exe not assembled");
    return;
  }
  const parsed = parsePeImports(exe);
  assert.equal(parsed.pe32plus, true);
  assert.ok(parsed.dlls.some((d) => /poppler\.dll/i.test(d.dll)));
  const pool = new Map();
  for (const name of readdirSync(dest)) {
    if (/\.(dll|exe)$/i.test(name)) pool.set(name.toLowerCase(), join(dest, name));
  }
  const { needed, vcRuntime } = walkWindowsClosure(exe, pool);
  assert.ok(needed.size >= 8);
  assert.ok(vcRuntime.some((n) => /VCRUNTIME140/i.test(n)));
  assert.equal(existsSync(join(dest, "poppler.dll")), true);
  assert.equal(existsSync(join(dest, "libcurl.dll")), true);
  assert.equal(existsSync(join(dest, "icuuc78.dll")), true);
  assert.equal(existsSync(join(dest, "icudt78.dll")), true);
  assert.equal(existsSync(join(dest, "share/poppler/cMap")), true);
  assert.equal(existsSync(join(dest, "cairo.dll")), false);
  assert.equal(existsSync(join(dest, "poppler-glib.dll")), false);
  const empty = new Map([["pdftoppm.exe", exe]]);
  assert.throws(() => walkWindowsClosure(exe, empty), /unresolved Windows DLL/);
  const pinned = popplerAssetForTarget("win32-x86_64").publishedTreeSha256;
  if (pinned) assert.equal(publishedTreeDigest(dest), pinned);
  const manifest = JSON.parse(readFileSync(join(dest, "manifest.json"), "utf8"));
  assert.match(String(manifest.windowsDatadirNote), /<payload>\/share\/poppler/);
  assert.ok(manifest.vcRuntime.some((n) => /VCRUNTIME140/i.test(n)));
});

function buildCjkLimitPdf(pageCount = 10) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = add("PLACEHOLDER");
  const fontLatin = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const cid = add(
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> /FontDescriptor 5 0 R /DW 1000 >>",
  );
  const fd = add(
    "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [-100 -250 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 800 /StemV 80 >>",
  );
  const fontCjk = add(
    `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${cid} 0 R] >>`,
  );
  const pageIds = [];
  for (let i = 0; i < pageCount; i += 1) {
    const stream =
      i === 0
        ? `BT /F1 16 Tf 50 720 Td (Penglai 0.5.12 pdftoppm page 1/${pageCount}) Tj 0 -28 Td (CJK sample UniGB-UCS2-H) Tj 0 -40 Td /C2 28 Tf <4E2D65876D4B8BD584EC83B1> Tj 0 -36 Td /F1 12 Tf (Zhongwen ceshi Penglai) Tj ET\n`
        : `BT /F1 16 Tf 50 720 Td (Penglai 0.5.12 pdftoppm page ${i + 1}/${pageCount}) Tj 0 -28 Td (Limit probe page. Bundled helper must stop at -l 8.) Tj ET\n`;
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${fontLatin} 0 R /C2 ${fontCjk} 0 R >> >> >>`,
      ),
    );
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  let offset = 0;
  const chunks = ["%PDF-1.4\n"];
  offset = chunks[0].length;
  const xref = [0];
  for (let i = 0; i < objects.length; i += 1) {
    const obj = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    xref.push(offset);
    chunks.push(obj);
    offset += Buffer.byteLength(obj);
  }
  const xrefStart = offset;
  let xrefTable = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < xref.length; i += 1) xrefTable += `${String(xref[i]).padStart(10, "0")} 00000 n \n`;
  chunks.push(xrefTable);
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return Buffer.from(chunks.join(""), "utf8");
}

function adHocSignMachOs(tree) {
  const names = readdirSync(tree).filter((name) => name === "pdftoppm" || name.endsWith(".dylib"));
  for (const name of names) {
    const signed = spawnSync("codesign", ["--force", "--sign", "-", join(tree, name)], { encoding: "utf8" });
    assert.equal(signed.status, 0, `${name}: ${signed.stderr}`);
  }
}

test("bundled darwin-aarch64 pdftoppm renders CJK PNG pages and honors -l 8", { skip: process.platform !== "darwin" || process.arch !== "arm64" }, (t) => {
  const dest = join(ROOT, "third_party/poppler/darwin-aarch64");
  const published = join(dest, "pdftoppm");
  if (!existsSync(published)) {
    t.skip("pinned conda pdftoppm not assembled");
    return;
  }
  const publishedSign = spawnSync("codesign", ["--display", published], { encoding: "utf8" });
  assert.match(`${publishedSign.stderr}${publishedSign.stdout}`, /not signed|code object is not signed/i);
  const work = mkdtempSync(join(tmpdir(), "penglai-poppler-cjk-"));
  const runTree = join(work, "tree");
  cpSync(dest, runTree, { recursive: true });
  adHocSignMachOs(runTree);
  const bin = join(runTree, "pdftoppm");
  const pdf = join(work, "cjk-10page.pdf");
  writeFileSync(pdf, buildCjkLimitPdf(10));
  const prefix = join(work, "page");
  const env = {
    HOME: work,
    TMPDIR: work,
    FONTCONFIG_PATH: join(runTree, "fonts"),
    DYLD_PRINT_LIBRARIES: "1",
    PATH: "/usr/bin:/bin",
  };
  const rendered = spawnSync(bin, ["-png", "-r", "72", "-f", "1", "-l", "8", pdf, prefix], {
    encoding: "utf8",
    cwd: runTree,
    env,
    timeout: 15000,
  });
  assert.equal(rendered.status, 0, `${rendered.signal || ""} ${rendered.stderr}`);
  assert.doesNotMatch(rendered.stderr, /Missing language pack/);
  assert.doesNotMatch(rendered.stderr, /homebrew|\/opt\/homebrew/i);
  assert.match(rendered.stderr, /pdftoppm/);
  assert.match(rendered.stderr, /libpoppler\.164\.dylib/);
  const dyldSawCopy =
    rendered.stderr.includes(runTree) ||
    rendered.stderr.includes(runTree.replace(/^\/var\//, "/private/var/")) ||
    rendered.stderr.includes(runTree.replace(/^\/tmp\//, "/private/tmp/"));
  assert.equal(dyldSawCopy, true, "dyld must load the ad-hoc-signed copy, not PATH");
  assert.doesNotMatch(rendered.stderr, /\/opt\/homebrew\/.*pdftoppm/);
  const pngs = readdirSync(work)
    .filter((name) => name.endsWith(".png"))
    .sort();
  assert.equal(pngs.length, 8);
  assert.equal(
    pngs.every((name) => /^page-0?[1-8]\.png$/.test(name)),
    true,
    pngs.join(","),
  );
  assert.equal(pngs.some((name) => /9/.test(name)), false);
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let total = 0;
  for (const name of pngs) {
    const buf = readFileSync(join(work, name));
    assert.equal(buf.subarray(0, 8).equals(magic), true, name);
    assert.ok(buf.length <= 1_500_000, name);
    total += buf.length;
  }
  assert.ok(total <= 6 * 1024 * 1024);
  const page1 = readFileSync(join(work, pngs[0]));
  const page2 = readFileSync(join(work, pngs[1]));
  assert.ok(page1.length > page2.length, "CJK page should rasterize extra glyphs");
  rmSync(work, { recursive: true, force: true });
});
