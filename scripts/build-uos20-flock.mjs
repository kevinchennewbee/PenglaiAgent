#!/usr/bin/env node
// Architecture-build official DSH flock.c for UOS 20 old-world linux-loong64.
// Zig gnu.2.36 output is new-world and must not be shipped.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(
  ROOT,
  "node_modules",
  "@deepseek-ai",
  "node-addon-system",
  "src",
  "flock.c",
);
const TOOLCHAIN =
  process.env.PENGLAI_UOS20_TOOLCHAIN ||
  "/tmp/penglai-grok-manager/0.6.0/toolchain/loongson-gnu-toolchain-8.3-x86_64-loongarch64-linux-gnu-rc1.6";
const SYSROOT = join(TOOLCHAIN, "loongarch64-linux-gnu", "sysroot");
const HEADERS =
  process.env.PENGLAI_UOS20_NODE_HEADERS ||
  "/tmp/penglai-grok-manager/0.6.0/uos-runtime/node_headers_extract/node_headers/include/node";
const OUT =
  process.env.PENGLAI_UOS20_FLOCK_OUT ||
  "/tmp/penglai-grok-manager/0.6.0/addons/linux-loong64/bin/glibc/system.node";

function fail(message) {
  console.error(JSON.stringify({ verdict: "FAIL", command: "build-uos20-flock", reason: message }));
  process.exit(1);
}

if (!existsSync(SRC)) fail(`missing flock.c at ${SRC}`);
if (!existsSync(join(SYSROOT, "lib64", "libc-2.28.so"))) fail("missing gcc 8.3 old-world sysroot libc-2.28");
if (!existsSync(join(HEADERS, "node_api.h"))) fail("missing Electron 31 node_headers node_api.h");

const work = join(dirname(OUT), "linkroot");
mkdirSync(join(work, "lib64"), { recursive: true });
mkdirSync(join(work, "usr", "lib64"), { recursive: true });
copyFileSync(join(SYSROOT, "lib64", "libc-2.28.so"), join(work, "lib64", "libc.so.6"));
copyFileSync(join(SYSROOT, "lib64", "ld-2.28.so"), join(work, "lib64", "ld.so.1"));
copyFileSync(join(SYSROOT, "usr", "lib64", "libc_nonshared.a"), join(work, "usr", "lib64", "libc_nonshared.a"));
for (const name of ["crti.o", "crtn.o", "crt1.o"]) {
  copyFileSync(join(SYSROOT, "usr", "lib64", name), join(work, "usr", "lib64", name));
}
writeFileSync(
  join(work, "usr", "lib64", "libc.so"),
  "OUTPUT_FORMAT(elf64-loongarch)\nGROUP ( libc.so.6 libc_nonshared.a AS_NEEDED ( ld.so.1 ) )\n",
);
const libcTxt = join(dirname(OUT), "libc.txt");
writeFileSync(
  libcTxt,
  [
    `include_dir=${join(SYSROOT, "usr", "include")}`,
    `sys_include_dir=${join(SYSROOT, "usr", "include")}`,
    `crt_dir=${join(work, "usr", "lib64")}`,
    "msvc_lib_dir=",
    "kernel32_lib_dir=",
    "gcc_dir=",
    "",
  ].join("\n"),
);

const zig = spawnSync(
  "zig",
  [
    "build-lib",
    "-dynamic",
    "-fPIC",
    "-OReleaseSmall",
    "-target",
    "loongarch64-linux-gnu.2.28",
    "--libc",
    libcTxt,
    "-isystem",
    join(SYSROOT, "usr", "include"),
    "-I",
    HEADERS,
    join(work, "lib64", "libc.so.6"),
    "-femit-bin",
    OUT,
    SRC,
  ],
  { encoding: "utf8" },
);
if (zig.status !== 0) fail(zig.stderr || zig.stdout || "zig build-lib failed");
const bytes = readFileSync(OUT);
if (bytes.includes(Buffer.from("/lib64/ld-linux-loongarch-lp64d.so.1"))) {
  fail("flock addon NEEDED new-world loader");
}
const sha256 = createHash("sha256").update(bytes).digest("hex");
console.log(
  JSON.stringify({
    verdict: "BUILT",
    native: false,
    out: OUT,
    bytes: bytes.length,
    sha256,
    interpreter: "shared-object-no-PT_INTERP",
    needed: "libc.so.6",
    glibcMax: "GLIBC_2.27",
  }),
);
