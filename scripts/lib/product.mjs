import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { ROOT } from "./repo.mjs";

const pins = await import(pathToFileURL(join(ROOT, "packages/release-identity/src/pins.ts")).href);

export const PRODUCT_VERSION = pins.PRODUCT_VERSION;
export const PRODUCT_NAME = pins.PRODUCT_NAME;
export const PINNED_DSH = pins.PINNED_DSH;
export const PINNED_DSH_COMMIT = pins.PINNED_DSH_COMMIT;
export const PINNED_DSH_TAG = pins.PINNED_DSH_TAG;
export const PINNED_DSH_TARBALL_SHA256 = pins.PINNED_DSH_TARBALL_SHA256;
export const PINNED_DSH_CLOSURE_MANIFEST_SHA256 = pins.PINNED_DSH_CLOSURE_MANIFEST_SHA256;
export const PINNED_DSH_CLOSURE_PACKAGE_COUNT = pins.PINNED_DSH_CLOSURE_PACKAGE_COUNT;
export const PINNED_NODE = pins.PINNED_NODE;
export const PINNED_ELECTRON = pins.PINNED_ELECTRON;
export const PINNED_PNPM = pins.PINNED_PNPM;
export const TRUST_TIER = pins.TRUST_TIER;
export const GENERATION_ID = pins.GENERATION_ID;
export const CANDIDATE_KIND = pins.CANDIDATE_KIND;
export const RELEASE_TARGETS = pins.RELEASE_TARGETS;
export const RUNTIME_INPUTS = pins.RUNTIME_INPUTS;
export const PUBLICATION_TARGET = pins.PUBLICATION_TARGET;
export const UPDATER_SEQUENCE = pins.UPDATER_SEQUENCE;
export const releaseTargetFromHost = pins.releaseTargetFromHost;

export function macosAarch64DmgName(version = PRODUCT_VERSION) {
  return `Penglai_${version}_macos_aarch64.dmg`;
}

export function macosX64DmgName(version = PRODUCT_VERSION) {
  return `Penglai_${version}_macos_x64.dmg`;
}

export function windowsSetupName(version = PRODUCT_VERSION) {
  return `Penglai_${version}_windows_x64_setup.exe`;
}

export function stagedAppDir(arch, version = PRODUCT_VERSION) {
  return `dist/Penglai-v${version}-${arch}`;
}
