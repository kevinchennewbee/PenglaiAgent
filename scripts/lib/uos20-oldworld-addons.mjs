import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { ROOT } from "./repo.mjs";

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const EM_LOONGARCH = 258;
const UOS20_NEW_WORLD_INTERPRETER = "/lib64/ld-linux-loongarch-lp64d.so.1";

export const UOS20_OLDWORLD_ADDON_ROOT = join(
  ROOT,
  "native",
  "linux-loong64-oldworld",
);

export const UOS20_OLDWORLD_ADDONS = Object.freeze({
  koffi: Object.freeze({
    file: "koffi.node",
    sha256: "4e19ac67411eb7ff1afde00150f90f22f802e649f90ac86572ae36814edd8a90",
  }),
  sharp: Object.freeze({
    file: "sharp-linux-loong64-0.35.4.node",
    sha256: "7967795e0f7d5274cb7d8480e2fb73b85ce3d0bfc0981e4eab8272463b27a2c2",
  }),
  libvips: Object.freeze({
    file: "libvips-cpp.so.42.20.6",
    sha256: "2e9438ad2c854acc6c9d50ea9d84d0b9083b1d06b2ec425c1993e11dd10cedd6",
    soname: "libvips-cpp.so.42.20.6",
  }),
  flock: Object.freeze({
    file: "system.node",
    sha256: "b065bcb1945dffa04a075578dff55a50604c3901716912714b81c24757167868",
  }),
  pty: Object.freeze({
    file: "pty.node",
    sha256: "5b5b7386569040bdc5af2c3f5213757e032636b0b80b50a3675eb2e347f73cb0",
  }),
});

export const NEW_WORLD_LOADER_SONAME = "ld-linux-loongarch-lp64d.so.1";

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function oldWorldAddonPath(file) {
  return join(UOS20_OLDWORLD_ADDON_ROOT, "artifacts", file);
}

function assertPinnedArtifact(spec, label) {
  const path = oldWorldAddonPath(spec.file);
  if (!existsSync(path)) {
    throw new Error(`UOS 20 old-world ${label} missing at ${path}`);
  }
  const bytes = readFileSync(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== spec.sha256) {
    throw new Error(
      `UOS 20 old-world ${label} digest ${digest} is not the pinned ${spec.sha256}`,
    );
  }
  if (bytes.includes(Buffer.from(NEW_WORLD_LOADER_SONAME))) {
    throw new Error(`UOS 20 old-world ${label} contains new-world loader soname`);
  }
  if (bytes.includes(Buffer.from(UOS20_NEW_WORLD_INTERPRETER))) {
    throw new Error(`UOS 20 old-world ${label} contains new-world interpreter path`);
  }
  if (bytes.length < 20 || !bytes.subarray(0, 4).equals(ELF_MAGIC)) {
    throw new Error(`UOS 20 old-world ${label} is not ELF`);
  }
  const machine = bytes.readUInt16LE(18);
  if (machine !== EM_LOONGARCH) {
    throw new Error(`UOS 20 old-world ${label} ELF machine ${machine} is not LoongArch`);
  }
  return { path, bytes, digest };
}

function writeFile(dest, bytes, mode = 0o644) {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes, { mode });
  chmodSync(dest, mode);
}

function copyPinned(spec, dest, label, mode = 0o755) {
  const { bytes } = assertPinnedArtifact(spec, label);
  writeFile(dest, bytes, mode);
}

/**
 * Overlay architecture-built natives into a flattened DSH node_modules.
 * Replaces unpublished/new-world optional packages. Does not rewrite official
 * sharp/koffi JavaScript.
 */
export function overlayUos20OldWorldAddons(modulesDir) {
  if (!modulesDir) throw new Error("UOS overlay requires DSH node_modules");
  const koffiRoot = join(modulesDir, "@koromix", "koffi-linux-loong64");
  mkdirSync(join(koffiRoot, "linux_loong64"), { recursive: true });
  const koffiPkgSrc = join(
    UOS20_OLDWORLD_ADDON_ROOT,
    "artifacts",
    "koffi-package.json",
  );
  const koffiIndexSrc = join(
    UOS20_OLDWORLD_ADDON_ROOT,
    "artifacts",
    "koffi-index.js",
  );
  if (!existsSync(koffiPkgSrc) || !existsSync(koffiIndexSrc)) {
    throw new Error("UOS 20 koffi overlay package.json/index.js missing");
  }
  cpSync(koffiPkgSrc, join(koffiRoot, "package.json"));
  cpSync(koffiIndexSrc, join(koffiRoot, "index.js"));
  copyPinned(
    UOS20_OLDWORLD_ADDONS.koffi,
    join(koffiRoot, "linux_loong64", "koffi.node"),
    "koffi.node",
  );

  const sharpRelease = join(
    modulesDir,
    "sharp",
    "src",
    "build",
    "Release",
  );
  if (!existsSync(join(modulesDir, "sharp", "package.json"))) {
    throw new Error(
      "UOS overlay refused: official sharp JS package missing from DSH closure",
    );
  }
  copyPinned(
    UOS20_OLDWORLD_ADDONS.sharp,
    join(sharpRelease, "sharp-linux-loong64-0.35.4.node"),
    "sharp-linux-loong64-0.35.4.node",
  );
  copyPinned(
    UOS20_OLDWORLD_ADDONS.libvips,
    join(sharpRelease, "libvips-cpp.so.42.20.6"),
    "libvips-cpp.so.42.20.6",
  );

  const flockRoot = join(
    modulesDir,
    "@deepseek-ai",
    "node-addon-system-linux-loong64",
  );
  writeFile(
    join(flockRoot, "package.json"),
    Buffer.from(
      `${JSON.stringify(
        {
          name: "@deepseek-ai/node-addon-system-linux-loong64",
          version: "0.1.2",
          description:
            "Old-world UOS 20 architecture build of DSH flock.c (unpublished npm name)",
          os: ["linux"],
          cpu: ["loong64"],
          license: "BSD-3-Clause",
        },
        null,
        2,
      )}\n`,
    ),
  );
  copyPinned(
    UOS20_OLDWORLD_ADDONS.flock,
    join(flockRoot, "bin", "glibc", "system.node"),
    "flock system.node",
  );

  copyPinned(
    UOS20_OLDWORLD_ADDONS.pty,
    join(modulesDir, "node-pty", "prebuilds", "linux-loong64", "pty.node"),
    "pty.node",
  );
  return {
    koffi: UOS20_OLDWORLD_ADDONS.koffi.sha256,
    sharp: UOS20_OLDWORLD_ADDONS.sharp.sha256,
    libvips: UOS20_OLDWORLD_ADDONS.libvips.sha256,
    flock: UOS20_OLDWORLD_ADDONS.flock.sha256,
    pty: UOS20_OLDWORLD_ADDONS.pty.sha256,
  };
}

export function assertUos20OldWorldAddonFiles(modulesDir) {
  const checks = [
    [
      join(modulesDir, "@koromix", "koffi-linux-loong64", "linux_loong64", "koffi.node"),
      UOS20_OLDWORLD_ADDONS.koffi.sha256,
      "koffi.node",
    ],
    [
      join(
        modulesDir,
        "sharp",
        "src",
        "build",
        "Release",
        "sharp-linux-loong64-0.35.4.node",
      ),
      UOS20_OLDWORLD_ADDONS.sharp.sha256,
      "sharp.node",
    ],
    [
      join(
        modulesDir,
        "sharp",
        "src",
        "build",
        "Release",
        "libvips-cpp.so.42.20.6",
      ),
      UOS20_OLDWORLD_ADDONS.libvips.sha256,
      "libvips-cpp",
    ],
    [
      join(
        modulesDir,
        "@deepseek-ai",
        "node-addon-system-linux-loong64",
        "bin",
        "glibc",
        "system.node",
      ),
      UOS20_OLDWORLD_ADDONS.flock.sha256,
      "flock",
    ],
    [
      join(modulesDir, "node-pty", "prebuilds", "linux-loong64", "pty.node"),
      UOS20_OLDWORLD_ADDONS.pty.sha256,
      "pty.node",
    ],
  ];
  for (const [path, expected, label] of checks) {
    if (!existsSync(path)) {
      throw new Error(`linux-loong64 payload missing ${label} at ${path}`);
    }
    const digest = sha256File(path);
    if (digest !== expected) {
      throw new Error(
        `linux-loong64 ${label} digest ${digest} is not the pinned ${expected}`,
      );
    }
  }
}
