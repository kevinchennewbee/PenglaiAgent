import { macosAarch64DmgName, macosX64DmgName, windowsSetupName, uosDebName } from "./product.mjs";

export const RELEASE_TARGETS = Object.freeze([
  "darwin-aarch64",
  "darwin-x86_64",
  "win32-x86_64",
  "linux-loong64",
]);

/** Mac/Windows native install/lifecycle. linux-loong64 native is OWNER_POST_RELEASE. */
export const NATIVE_INSTALLED_TARGETS = Object.freeze([
  "darwin-aarch64",
  "darwin-x86_64",
  "win32-x86_64",
]);

export const TARGET_INSTALLERS = Object.freeze({
  "darwin-aarch64": macosAarch64DmgName(),
  "darwin-x86_64": macosX64DmgName(),
  "win32-x86_64": windowsSetupName(),
  "linux-loong64": uosDebName(),
});

export function assertReleaseTarget(target) {
  if (!RELEASE_TARGETS.includes(target)) {
    throw new Error(`unsupported release target ${target}`);
  }
  return target;
}

export function installerForTarget(target) {
  assertReleaseTarget(target);
  return TARGET_INSTALLERS[target];
}

export function hostMatchesTarget(target, platform = process.platform, arch = process.arch) {
  if (target === "darwin-aarch64") return platform === "darwin" && arch === "arm64";
  if (target === "darwin-x86_64") return platform === "darwin" && arch === "x64";
  if (target === "win32-x86_64") return platform === "win32" && arch === "x64";
  if (target === "linux-loong64") {
    return platform === "linux" && (arch === "loong64" || arch === "loongarch64");
  }
  return false;
}

export function parseTargetArg(argv = process.argv, env = process.env) {
  const flag = argv.includes("--target") ? argv[argv.indexOf("--target") + 1] : undefined;
  return assertReleaseTarget(flag || env.PENGLAI_TARGET || env.PENGLAI_EXPECTED_TARGET || "darwin-aarch64");
}

export function evidenceName(kind, target) {
  assertReleaseTarget(target);
  return `${kind}-${target}.json`;
}

export function nativeBlocked(command, target) {
  if (hostMatchesTarget(target)) return null;
  return {
    verdict: "BLOCKED",
    command,
    reason: `${command} native evidence is only legal on a host matching ${target}`,
    target,
    host: { platform: process.platform, arch: process.arch },
    native: false,
  };
}

export function walkedCoreOnboarding(walked) {
  const set = new Set(walked ?? []);
  return set.has("workspace") && (set.has("firstturn") || set.has("first-turn") || set.has("first-turn-v1"));
}

export function missingReleaseTargets(present) {
  const have = new Set(present ?? []);
  return RELEASE_TARGETS.filter((target) => !have.has(target));
}

export function missingNativeInstalledTargets(present) {
  const have = new Set(present ?? []);
  return NATIVE_INSTALLED_TARGETS.filter((target) => !have.has(target));
}
