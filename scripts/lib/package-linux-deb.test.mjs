import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { RELEASE_TARGETS, TARGET_INSTALLERS } from "./release-targets.mjs";
import {
  LINUX_LOONG64_TARGET,
  REQUIRED_BUILTIN_PLUGIN_IDS,
  UOS20_NEW_WORLD_INTERPRETER,
  UOS20_OLD_WORLD_INTERPRETER,
  UOS_DEB_ARCHITECTURE,
  UOS_DEB_INSTALLER_NAME,
  assertLinuxLoong64PackTarget,
  assertPackagedDesktopSkip,
  assertUos20OldWorldBinary,
  assertUosRuntimeClosure,
  glibcVersionsNewerThan228,
  overlayDesktopBundle,
  packageLinuxDeb,
  parseDebControl,
  parseDebDataFiles,
  readElfInterpreter,
  renderDebControl,
  uosDebInstallerName,
} from "./package-linux-deb.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function writePluginCatalog(pluginsDir, extra = {}) {
  mkdirSync(pluginsDir, { recursive: true });
  const office = "penglai-office-0.6.0.tgz";
  const memory = "penglai-memory-0.6.0.tgz";
  writeFileSync(join(pluginsDir, office), "office-plugin\n");
  writeFileSync(join(pluginsDir, memory), "memory-plugin\n");
  writeFileSync(
    join(pluginsDir, "catalog.json"),
    JSON.stringify(
      {
        schema: 3,
        target: LINUX_LOONG64_TARGET,
        entries: [
          {
            id: "@penglai/office",
            packageFile: office,
            installClass: "required-builtin",
            defaultEnabled: true,
          },
          {
            id: "@penglai/memory",
            packageFile: memory,
            installClass: "required-builtin",
            defaultEnabled: true,
          },
        ],
        ...extra,
      },
      null,
      2,
    ),
  );
}

function writePayload(rootDir, { catalog, sandbox = true } = {}) {
  mkdirSync(join(rootDir, "resources", "app"), { recursive: true });
  writeFileSync(join(rootDir, "Penglai"), "#!/bin/sh\necho penglai\n");
  chmodSync(join(rootDir, "Penglai"), 0o755);
  if (sandbox) writeFileSync(join(rootDir, "chrome-sandbox"), "sandbox-stub\n");
  writeFileSync(join(rootDir, "resources", "app", "electron-main.js"), "void 0;\n");
  writePluginCatalog(join(rootDir, "resources", "plugins"), catalog);
}

test("packager fails closed unless the Penglai target key is linux-loong64", () => {
  assert.equal(assertLinuxLoong64PackTarget("linux-loong64"), LINUX_LOONG64_TARGET);
  for (const target of [
    "linux-x64",
    "linux-arm64",
    "linux-loongarch64",
    "loong64",
    "loongarch64",
    "darwin-arm64",
    "win32-x64",
    undefined,
  ]) {
    assert.throws(
      () => assertLinuxLoong64PackTarget(target),
      /target must be linux-loong64/,
    );
  }
  const refused = spawnSync(
    process.execPath,
    [join(root, "scripts/package-linux-deb.mjs"), "--target", "linux-x64"],
    { encoding: "utf8" },
  );
  assert.notEqual(refused.status, 0);
  assert.match(`${refused.stderr}${refused.stdout}`, /linux-loong64/);
});

test("UOS installer name is packager-owned and in RELEASE_TARGETS", () => {
  assert.equal(uosDebInstallerName(), "Penglai_0.6.0_uos_loong64.deb");
  assert.equal(UOS_DEB_INSTALLER_NAME, "Penglai_0.6.0_uos_loong64.deb");
  assert.equal(RELEASE_TARGETS.includes("linux-loong64"), true);
  assert.equal(TARGET_INSTALLERS["linux-loong64"], "Penglai_0.6.0_uos_loong64.deb");
});

test("control Architecture is loongarch64 while target key stays linux-loong64", () => {
  const control = renderDebControl({ installedSizeKb: 12 });
  assert.match(control, /^Architecture: loongarch64$/m);
  assert.match(control, /^X-Penglai-Target: linux-loong64$/m);
  assert.doesNotMatch(control, /^Architecture: loong64$/m);
  assert.throws(
    () => renderDebControl({ architecture: "loong64" }),
    /loongarch64/,
  );
  assert.throws(
    () => renderDebControl({ architecture: "amd64" }),
    /loongarch64/,
  );
});

test("staged .deb keeps /opt/Penglai, desktop file, and required Office+Memory", () => {
  const work = mkdtempSync(join(tmpdir(), "penglai-deb-"));
  try {
    const payload = join(work, "payload");
    const outDir = join(work, "out");
    const icon = join(work, "penglai.png");
    writePayload(payload);
    writeFileSync(icon, PNG_1X1);
    const packed = packageLinuxDeb({
      target: LINUX_LOONG64_TARGET,
      payloadRoot: payload,
      outDir,
      iconPath: icon,
      requireRuntimeClosure: false,
    });
    assert.equal(packed.installerName, UOS_DEB_INSTALLER_NAME);
    assert.equal(packed.architecture, UOS_DEB_ARCHITECTURE);
    assert.equal(packed.target, LINUX_LOONG64_TARGET);
    assert.equal(existsSync(join(outDir, UOS_DEB_INSTALLER_NAME)), true);
    const deb = readFileSync(packed.outPath);
    const control = parseDebControl(deb);
    assert.equal(control.Architecture, "loongarch64");
    assert.equal(control["X-Penglai-Target"], "linux-loong64");
    assert.equal(control.Package, "penglai");
    assert.equal(control.Version, "0.6.0");
    const data = parseDebDataFiles(deb);
    assert.equal(data.has("opt/Penglai/Penglai"), true);
    assert.equal(data.has("opt/Penglai/chrome-sandbox"), true);
    assert.equal(data.has("usr/share/applications/penglai.desktop"), true);
    assert.equal(data.has("usr/bin/penglai"), true);
    const desktop = data.get("usr/share/applications/penglai.desktop").toString("utf8");
    assert.match(desktop, /Exec=\/opt\/Penglai\/Penglai %U/);
    assert.match(desktop, /X-Penglai-Target=linux-loong64/);
    assert.equal(
      data.has("opt/Penglai/resources/plugins/penglai-office-0.6.0.tgz"),
      true,
    );
    assert.equal(
      data.has("opt/Penglai/resources/plugins/penglai-memory-0.6.0.tgz"),
      true,
    );
    assert.deepEqual([...REQUIRED_BUILTIN_PLUGIN_IDS], [
      "@penglai/office",
      "@penglai/memory",
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("deliverable UOS packager fails closed without DSH Node and flock", () => {
  const work = mkdtempSync(join(tmpdir(), "penglai-deb-closure-"));
  try {
    const payload = join(work, "payload");
    const icon = join(work, "penglai.png");
    writePayload(payload);
    writeFileSync(icon, PNG_1X1);
    assert.throws(() => assertUosRuntimeClosure(payload), /runtime\/node\/bin\/node/);
    assert.throws(
      () =>
        packageLinuxDeb({
          target: LINUX_LOONG64_TARGET,
          payloadRoot: payload,
          outDir: join(work, "out"),
          iconPath: icon,
          requireRuntimeClosure: true,
        }),
      /package is not complete/,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("payload contract refuses missing sandbox or disabled Office/Memory", () => {
  const work = mkdtempSync(join(tmpdir(), "penglai-deb-neg-"));
  try {
    const icon = join(work, "penglai.png");
    writeFileSync(icon, PNG_1X1);
    const noSandbox = join(work, "no-sandbox");
    writePayload(noSandbox, { sandbox: false });
    assert.throws(
      () =>
        packageLinuxDeb({
          target: LINUX_LOONG64_TARGET,
          payloadRoot: noSandbox,
          outDir: join(work, "out"),
          iconPath: icon,
        }),
      /chrome-sandbox/,
    );
    const disabled = join(work, "disabled-office");
    writePayload(disabled, {
      catalog: {
        entries: [
          {
            id: "@penglai/office",
            packageFile: "penglai-office-0.6.0.tgz",
            installClass: "optional-first-party",
            defaultEnabled: false,
          },
          {
            id: "@penglai/memory",
            packageFile: "penglai-memory-0.6.0.tgz",
            installClass: "required-builtin",
            defaultEnabled: true,
          },
        ],
      },
    });
    assert.throws(
      () =>
        packageLinuxDeb({
          target: LINUX_LOONG64_TARGET,
          payloadRoot: disabled,
          outDir: join(work, "out2"),
          iconPath: icon,
        }),
      /required-builtin/,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

function elfWithInterpreter(interpreter) {
  const interp = Buffer.from(`${interpreter}\0`, "utf8");
  const ehsize = 64;
  const phentsize = 56;
  const phoff = ehsize;
  const interpOff = ehsize + phentsize;
  const buf = Buffer.alloc(interpOff + interp.length + 8);
  buf.write("\u007fELF", 0, 4, "binary");
  buf[4] = 2;
  buf[5] = 1;
  buf[6] = 1;
  buf.writeUInt16LE(2, 16);
  buf.writeUInt16LE(258, 18);
  buf.writeUInt32LE(1, 20);
  buf.writeBigUInt64LE(BigInt(phoff), 32);
  buf.writeUInt16LE(ehsize, 52);
  buf.writeUInt16LE(phentsize, 54);
  buf.writeUInt16LE(1, 56);
  buf.writeUInt32LE(3, phoff);
  buf.writeBigUInt64LE(BigInt(interpOff), phoff + 8);
  buf.writeBigUInt64LE(BigInt(interp.length), phoff + 32);
  interp.copy(buf, interpOff);
  return buf;
}

test("UOS 20 runtime closure rejects GLIBC newer than 2.28", () => {
  assert.deepEqual(glibcVersionsNewerThan228(Buffer.from("GLIBC_2.27\0GLIBC_2.28\0")), []);
  assert.deepEqual(glibcVersionsNewerThan228(Buffer.from("GLIBC_2.36\0")), ["GLIBC_2.36"]);
});

test("UOS 20 packager refuses a new-world Penglai ELF and accepts old-world ld.so.1", () => {
  assert.equal(readElfInterpreter(Buffer.from("#!/bin/sh\n")), undefined);
  assert.equal(
    readElfInterpreter(elfWithInterpreter(UOS20_OLD_WORLD_INTERPRETER)),
    UOS20_OLD_WORLD_INTERPRETER,
  );
  assert.equal(
    readElfInterpreter(elfWithInterpreter(UOS20_NEW_WORLD_INTERPRETER)),
    UOS20_NEW_WORLD_INTERPRETER,
  );
  const work = mkdtempSync(join(tmpdir(), "penglai-deb-abi-"));
  try {
    const oldWorld = join(work, "old");
    writePayload(oldWorld);
    writeFileSync(join(oldWorld, "Penglai"), elfWithInterpreter(UOS20_OLD_WORLD_INTERPRETER));
    chmodSync(join(oldWorld, "Penglai"), 0o755);
    assert.equal(assertUos20OldWorldBinary(join(oldWorld, "Penglai")), UOS20_OLD_WORLD_INTERPRETER);
    const newWorld = join(work, "new");
    writePayload(newWorld);
    writeFileSync(join(newWorld, "Penglai"), elfWithInterpreter(UOS20_NEW_WORLD_INTERPRETER));
    chmodSync(join(newWorld, "Penglai"), 0o755);
    assert.throws(
      () =>
        packageLinuxDeb({
          target: LINUX_LOONG64_TARGET,
          payloadRoot: newWorld,
          outDir: join(work, "out"),
          iconPath: join(work, "penglai.png"),
        }),
      /new-world/,
    );
    writeFileSync(join(work, "penglai.png"), PNG_1X1);
    assert.throws(
      () =>
        packageLinuxDeb({
          target: LINUX_LOONG64_TARGET,
          payloadRoot: newWorld,
          outDir: join(work, "out"),
          iconPath: join(work, "penglai.png"),
        }),
      /new-world/,
    );
    const sandboxNew = join(work, "sandbox-new");
    writePayload(sandboxNew);
    writeFileSync(join(sandboxNew, "Penglai"), elfWithInterpreter(UOS20_OLD_WORLD_INTERPRETER));
    chmodSync(join(sandboxNew, "Penglai"), 0o755);
    writeFileSync(join(sandboxNew, "chrome-sandbox"), elfWithInterpreter(UOS20_NEW_WORLD_INTERPRETER));
    assert.throws(
      () =>
        packageLinuxDeb({
          target: LINUX_LOONG64_TARGET,
          payloadRoot: sandboxNew,
          outDir: join(work, "out-sandbox"),
          iconPath: join(work, "penglai.png"),
        }),
      /chrome-sandbox is new-world/,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("linux packager overlays this SHA desktop bundle then fail-closes without the DSH home skip", () => {
  const work = mkdtempSync(join(tmpdir(), "penglai-deb-skip-"));
  try {
    const payload = join(work, "payload");
    mkdirSync(join(payload, "resources", "app"), { recursive: true });
    writeFileSync(join(payload, "resources", "app", "electron-main.js"), "void 0;\n");
    assert.throws(() => assertPackagedDesktopSkip(payload), /missing the rebuilt DSH home skip/);
    const bundle = join(work, "bundle");
    mkdirSync(bundle, { recursive: true });
    writeFileSync(
      join(bundle, "electron-main.js"),
      'startsWith("profiles/node_modules/"); ".dsh-module-fallback";\n',
    );
    overlayDesktopBundle(payload, bundle);
    assertPackagedDesktopSkip(payload);
    assert.match(
      readFileSync(join(payload, "resources", "app", "electron-main.js"), "utf8"),
      /dsh-module-fallback/,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
