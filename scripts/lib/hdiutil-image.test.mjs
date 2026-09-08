import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertHdiutilConvertArgs,
  detachDmgUntilReleased,
  disksAttachedToImage,
  hdiutilBusyRetryable,
  hdiutilConvertArgs,
  hdiutilCreateArgs,
} from "./hdiutil-image.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("hdiutil convert requires -o and exactly one input image", () => {
  const image = "/tmp/penglai-rw.dmg";
  const output = "/tmp/penglai-out.dmg";
  const args = hdiutilConvertArgs({
    image,
    output,
    format: "UDZO",
    imageKey: "zlib-level=9",
  });
  assert.deepEqual(args, [
    "convert",
    "-format",
    "UDZO",
    "-o",
    output,
    "-ov",
    "-imagekey",
    "zlib-level=9",
    image,
  ]);
  assert.deepEqual(assertHdiutilConvertArgs(args), {
    image,
    output,
    format: "UDZO",
  });

  const brokenNativeArgv = [
    "convert",
    image,
    "-format",
    "UDZO",
    "-imagekey",
    "zlib-level=9",
    "-ov",
    output,
  ];
  assert.throws(
    () => assertHdiutilConvertArgs(brokenNativeArgv),
    /requires -format and -o; hdiutil convert accepts exactly one input image, got 2/,
  );
  assert.throws(
    () => assertHdiutilConvertArgs(["convert", image, "-format", "UDZO", "-ov", output]),
    /requires -format and -o; hdiutil convert accepts exactly one input image, got 2/,
  );
  assert.throws(
    () => hdiutilConvertArgs({ image, output: image }),
    /input image and output must differ/,
  );
});

test("convert retries when the UDRW is still attached", () => {
  assert.equal(
    hdiutilBusyRetryable("hdiutil: convert failed - Resource temporarily unavailable"),
    true,
  );
  assert.equal(hdiutilBusyRetryable('hdiutil: couldn\'t eject "disk5" - Resource busy'), true);
  assert.equal(hdiutilBusyRetryable("hdiutil: convert failed - 资源暂时不可用"), true);
  assert.equal(hdiutilBusyRetryable("only a single input file can be specified"), false);
  const info = [
    "image-path      : /tmp/penglai-rw.dmg",
    "/dev/disk5           GUID_partition_scheme",
    "/dev/disk5s1         Apple_APFS",
    "/dev/disk6           EF57347C-0000-11AA-AA11-0030654",
    "/dev/disk6s1         41504653-0000-11AA-AA11-0030654 /Volumes/Penglai",
  ].join("\n");
  assert.deepEqual(disksAttachedToImage(info, "/tmp/penglai-rw.dmg"), [
    "/dev/disk5",
    "/dev/disk6",
  ]);
  assert.deepEqual(disksAttachedToImage(info, "/tmp/other.dmg"), []);
  const dmg = readFileSync(join(root, "scripts/build-local-dmg.mjs"), "utf8");
  assert.match(dmg, /detachDmgUntilReleased/);
  assert.match(dmg, /hdiutilBusyRetryable/);
  assert.match(dmg, /onRetry/);
  assert.doesNotMatch(dmg, /detach", image, "-force"/);
});

test("build-local-dmg uses the convert builder instead of a second positional path", () => {
  const dmg = readFileSync(join(root, "scripts/build-local-dmg.mjs"), "utf8");
  assert.match(dmg, /hdiutilConvertArgs/);
  assert.match(dmg, /hdiutilCreateArgs/);
  assert.doesNotMatch(
    dmg,
    /"convert",\s*\n\s*rwImage/,
    "convert must not treat rwImage as a leading positional input",
  );
  assert.doesNotMatch(
    dmg,
    /"-ov",\s*\n\s*dmgPath/,
    "convert must not pass the UDZO path as a second image after -ov",
  );
});

test("hdiutil convert -o is the native class that failed without -o", {
  skip: process.platform !== "darwin" ? "hdiutil is macOS-only" : false,
}, () => {
  const dir = mkdtempSync(join(tmpdir(), "penglai-hdiutil-"));
  try {
    const src = join(dir, "src");
    mkdirSync(src);
    writeFileSync(join(src, "hello.txt"), "penglai");
    const rw = join(dir, "rw.dmg");
    const out = join(dir, "out.dmg");
    const created = spawnSync(
      "hdiutil",
      hdiutilCreateArgs({
        volumeName: "PenglaiConvertTest",
        sourceFolder: src,
        format: "UDRW",
        output: rw,
      }),
      { encoding: "utf8" },
    );
    assert.equal(created.status, 0, created.stderr);
    const attached = spawnSync("hdiutil", ["attach", rw, "-readwrite", "-noverify", "-nobrowse"], {
      encoding: "utf8",
    });
    assert.equal(attached.status, 0, attached.stderr);
    detachDmgUntilReleased({ image: rw });
    assert.equal(disksAttachedToImage(spawnSync("hdiutil", ["info"], { encoding: "utf8" }).stdout, rw).length, 0);
    const broken = [
      "convert",
      rw,
      "-format",
      "UDZO",
      "-imagekey",
      "zlib-level=9",
      "-ov",
      out,
    ];
    const bad = spawnSync("hdiutil", broken, { encoding: "utf8" });
    assert.notEqual(bad.status, 0);
    assert.match(
      `${bad.stderr ?? ""}\n${bad.stdout ?? ""}`,
      /only a single input file can be specified/,
    );
    const ok = spawnSync(
      "hdiutil",
      hdiutilConvertArgs({
        image: rw,
        output: out,
        format: "UDZO",
        imageKey: "zlib-level=9",
      }),
      { encoding: "utf8" },
    );
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(existsSync(out), true);
    const verify = spawnSync("hdiutil", ["verify", out], { encoding: "utf8" });
    assert.equal(verify.status, 0, verify.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
