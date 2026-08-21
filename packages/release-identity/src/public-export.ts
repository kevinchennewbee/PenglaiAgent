import { createHash } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import {
  PINNED_DSH,
  PINNED_ELECTRON,
  PINNED_NODE,
  PINNED_PNPM,
  PRODUCT_VERSION,
  PUBLICATION_TARGET,
  RELEASE_TARGETS,
} from "./pins.js";

export const PUBLIC_EXPORT_ALLOW = [
  "apps",
  "packages",
  "scripts",
  "native",
  "profile-seed",
  "overlays",
  "third_party",
  "packaging",
  "docs/PRODUCT.md",
  "docs/ARCHITECTURE.md",
  "docs/SECURITY.md",
  "docs/PLATFORM_MATRIX.md",
  "docs/DISTRIBUTION.md",
  "docs/UPDATE_UNINSTALL.md",
  "docs/ONBOARDING_BYOK.md",
  "docs/PLUGIN_CENTER.md",
  "docs/IM_PLUGIN.md",
  "docs/CAPABILITY_MIGRATION.md",
  "docs/PUBLICATION_0.5.0.md",
  "docs/PUBLICATION_MANIFEST_0.5.0.md",
  "docs/RELEASE_NOTES_0.5.0.md",
  "docs/PUBLICATION_0.5.1.md",
  "docs/PUBLICATION_MANIFEST_0.5.1.md",
  "docs/RELEASE_NOTES_0.5.1.md",
  "docs/0.5.1",
  "docs/ACCEPTANCE.md",
  "docs/RELEASE_RUNBOOK.md",
  "docs/decisions.md",
  "docs/sources.md",
  "docs/adr",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  "release-contract.json",
  "release-info.json",
  ".nvmrc",
  ".gitignore",
  "PRODUCT_CONSTITUTION.md",
] as const;

export const PUBLIC_EXPORT_DENY = [
  ".git",
  "dist",
  "evidence",
  "node_modules",
  ".tmp",
  ".tmp-public-export",
  ".tmp-installed-from-dmg",
  ".tmp-installed-e2e",
  "STATE.md",
  "AGENTS.md",
  "docs/GROK_HANDOFF.md",
  "docs/PLAN.md",
  "packages/credentials-keychain",
  "packages/plugin-smoke",
  "packages/plugin-center/src/loopback-llm.ts",
  "packages/plugin-center/src/loopback-llm.test.ts",
  "packages/plugin-center/src/loopback-live.test.ts",
  "packages/plugin-center/src/usable-fixture.ts",
  "packages/plugin-center/src/usable-fixture.test.ts",
  "packages/im/src/test-only-causal.ts",
  "packages/release-identity/src/freeze.test.ts",
  "packages/release-identity/src/leftover-gates.test.ts",
  "packages/release-identity/src/remaining-gates.test.ts",
] as const;

export const REQUIRED_PUBLIC_DOCS = [
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "release-contract.json",
  "docs/SECURITY.md",
  "docs/PUBLICATION_0.5.0.md",
  "docs/PUBLICATION_MANIFEST_0.5.0.md",
  "docs/RELEASE_NOTES_0.5.0.md",
  "docs/PUBLICATION_0.5.1.md",
  "docs/PUBLICATION_MANIFEST_0.5.1.md",
  "docs/RELEASE_NOTES_0.5.1.md",
] as const;

export interface ExportFile {
  path: string;
  mode: string;
  size: number;
  sha256: string;
  license: string;
}

export function pathAllowed(rel: string): boolean {
  const norm = rel.replaceAll("\\", "/");
  if (PUBLIC_EXPORT_DENY.some((d) => norm === d || norm.startsWith(`${d}/`))) return false;
  return PUBLIC_EXPORT_ALLOW.some((a) => norm === a || norm.startsWith(`${a}/`));
}

export function classifyLicense(rel: string): string {
  const norm = rel.replaceAll("\\", "/");
  if (norm.startsWith("overlays/")) return "upstream-overlay";
  if (norm.startsWith("third_party/")) return "third-party";
  if (norm === "LICENSE") return "MIT";
  return "MIT";
}

export function publicExportTreeSha256(files: readonly ExportFile[]): string {
  const lines = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => `${f.path}:${f.mode}:${f.size}:${f.sha256}:${f.license}`);
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function assertRequiredPublicDocs(paths: readonly string[]): void {
  const set = new Set(paths);
  const missing = REQUIRED_PUBLIC_DOCS.filter((p) => !set.has(p));
  if (missing.length) throw new PenglaiError("INVALID_INPUT", `public-export missing ${missing.join(",")}`);
}

export function assertExportHasSourceNotOnlyBinary(paths: readonly string[]): void {
  const hasTs = paths.some((p) => p.endsWith(".ts") || p.endsWith(".mjs"));
  const hasOverlay = paths.some((p) => p.startsWith("overlays/"));
  const hasLock = paths.includes("pnpm-lock.yaml");
  const hasContract = paths.includes("release-contract.json");
  if (!hasTs || !hasLock || !hasContract) {
    throw new PenglaiError("INVALID_INPUT", "public-export must include source, lock, and provenance");
  }
  void hasOverlay;
}

export function assertPublicationTarget(publication: Record<string, unknown>): void {
  for (const key of ["repo", "tag", "release", "channel"] as const) {
    if (publication[key] !== PUBLICATION_TARGET[key]) {
      throw new PenglaiError("SECURITY_POLICY", `publication.${key} does not match authorized target`);
    }
  }
}

const REAL_SECRET = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-(?!test\b)[A-Za-z0-9_-]{20,}\b/,
  /\bwxp_[A-Za-z0-9_-]{16,}\b/,
  /App Secret\s*[:=]\s*[A-Za-z0-9]{12,}/i,
];

const OWNER_PATH = [/\/Volumes\/KevinSSD/i, /\/Users\/[A-Za-z0-9._-]{2,}\//, /C:\\Users\\[A-Za-z0-9._-]+/i];

export function scanExportText(rel: string, text: string): void {
  const testFile = /\.test\.(ts|mjs|js)$/.test(rel);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
    throw new PenglaiError("SECURITY_POLICY", `export:${rel} contains forbidden secret or owner path`);
  }
  if (testFile) return;
  for (const re of REAL_SECRET) {
    if (re.test(text)) throw new PenglaiError("SECURITY_POLICY", `export:${rel} contains forbidden secret or owner path`);
  }
  for (const re of OWNER_PATH) {
    if (re.test(text)) throw new PenglaiError("SECURITY_POLICY", `export:${rel} contains forbidden secret or owner path`);
  }
}

export function buildPublicationDraft(input: {
  privateCandidateSourceSha: string;
  publicExportTreeSha256: string;
  files: number;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    productVersion: PRODUCT_VERSION,
    candidateKind: "public-community-release",
    trustTier: "community-verified",
    generationId: "penglai-dsh-v0.5",
    phase: "UNFROZEN",
    privateCandidateSourceSha: input.privateCandidateSourceSha,
    publicExportTreeSha256: input.publicExportTreeSha256,
    exportFiles: input.files,
    pins: {
      dsh: PINNED_DSH,
      electron: PINNED_ELECTRON,
      node: PINNED_NODE,
      pnpm: PINNED_PNPM,
    },
    installers: RELEASE_TARGETS.map((row) => ({
      name: row.installer,
      sha256: "",
      native: "pending",
    })),
    limitations: [
      `${PRODUCT_VERSION} declares darwin-aarch64, darwin-x86_64, and win32-x86_64; native PASS requires a matching runner`,
      "community-verified: macOS ad-hoc/not notarized; Windows has no Authenticode",
      "0.5.0 to 0.5.1 is a manual overlay install on Apple Silicon; Intel/Windows are fresh installs",
      `no silent auto-update from 0.5.0; 0.5.1 discovers later immutable PenglaiAgent Releases`,
      "public destination is owner-authorized; execution is verified after publication",
    ],
    publication: {
      ...PUBLICATION_TARGET,
    },
  };
}

export function futurePublicAssetIdentityGate(acceptedSha256: string, publishedSha256: string): void {
  if (!/^[0-9a-f]{64}$/.test(acceptedSha256) || acceptedSha256 !== publishedSha256) {
    throw new PenglaiError("SECURITY_POLICY", "future public Release assets must be exact accepted bytes");
  }
}
