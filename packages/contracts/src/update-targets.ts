/**
 * The single source of truth for every platform the assisted updater can
 * address.
 *
 * `release-contract.json` (`targets`) and the signed update manifest are both
 * checked against this table. Before this existed, the table was duplicated in
 * two packages and drifted in opposite directions from the release contract:
 *
 * - `linux-loong64` was a published release target and `releaseTarget()` already
 *   returned it on UOS, but neither copy of `UPDATE_TARGETS` contained it, so
 *   every update check on UOS failed with `unsupported update target`.
 * - `darwin-x86_64` had been dropped from the release contract at 0.6.1 but was
 *   still advertised here as installable.
 *
 * Adding a platform is now one row. Nothing else may re-declare this list.
 */
/** Installer container the updater hands off to the operating system. */
export type InstallerKind = "dmg" | "setup" | "deb";

export interface UpdateTargetSpec {
  /** Target key as it appears in the release contract and update manifest. */
  readonly key: UpdateTargetKey;
  /** `process.platform` value. */
  readonly platform: string;
  /** `process.arch` value, with accepted aliases listed in platformArchAliases. */
  readonly arch: string;
  /** Installer kind this target hands off to. */
  readonly kind: InstallerKind;
  /** Exact installer filename; `{version}` is replaced with the release version. */
  readonly installer: string;
}

export const UPDATE_TARGETS: readonly UpdateTargetSpec[] = Object.freeze([
  Object.freeze({
    key: "darwin-aarch64",
    platform: "darwin",
    arch: "arm64",
    kind: "dmg",
    installer: "Penglai_{version}_macos_aarch64.dmg",
  }),
  Object.freeze({
    key: "darwin-x86_64",
    platform: "darwin",
    arch: "x64",
    kind: "dmg",
    installer: "Penglai_{version}_macos_x64.dmg",
  }),
  Object.freeze({
    key: "win32-x86_64",
    platform: "win32",
    arch: "x64",
    kind: "setup",
    installer: "Penglai_{version}_windows_x64_setup.exe",
  }),
  Object.freeze({
    key: "linux-loong64",
    platform: "linux",
    arch: "loong64",
    kind: "deb",
    installer: "Penglai_{version}_uos_loong64.deb",
  }),
]);

/**
 * Every target key the updater can address, as a literal union.
 *
 * `UPDATE_TARGETS` below must stay in step with this list; the test suite
 * asserts that, and `UPDATE_TARGET_KEYS` is the runtime form of this tuple.
 */
export const UPDATE_TARGET_KEYS = [
  "darwin-aarch64",
  "darwin-x86_64",
  "win32-x86_64",
  "linux-loong64",
] as const;

export type UpdateTargetKey = (typeof UPDATE_TARGET_KEYS)[number];

/**
 * Target keys only, for manifest and contract validation.
 *
 * Identical to `UPDATE_TARGET_KEYS`; kept as the runtime value so validators do
 * not have to import a type and a value under the same name.
 */
export const UPDATE_TARGET_KEY_LIST: readonly string[] = Object.freeze([...UPDATE_TARGET_KEYS]);

/** `process.arch` spellings that map onto a declared target arch. */
const ARCH_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  arm64: ["arm64"],
  x64: ["x64", "x86_64"],
  loong64: ["loong64", "loongarch64"],
});

export function updateTargetFor(key: string): UpdateTargetSpec | undefined {
  return UPDATE_TARGETS.find((target) => target.key === key);
}

/**
 * Resolve a runtime platform/arch pair to a target key, or `undefined` when the
 * pair is not an update target. Returning `undefined` instead of throwing keeps
 * "this build has no update channel" distinguishable from "the channel is
 * broken".
 */
export function updateTargetKeyFor(platform: string, arch: string): string | undefined {
  const hit = UPDATE_TARGETS.find(
    (target) =>
      target.platform === platform &&
      (ARCH_ALIASES[target.arch] ?? [target.arch]).includes(arch),
  );
  return hit?.key;
}

/** Exact installer filename for a target key at a given version. */
export function updateInstallerName(key: string, version: string): string | undefined {
  const target = updateTargetFor(key);
  return target ? target.installer.replace("{version}", version) : undefined;
}
