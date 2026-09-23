import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { declaredSourceSha, recordAssertion } from "./assertion.js";
import { PRODUCT_PATH_FILES } from "./product-path.js";

/**
 * Reverse existence: the excluded scope must be absent from the product.
 *
 * The 0.6.6 contract restores Budget and Companion but still excludes Office.
 * This reverse-existence check therefore applies only to the remaining
 * excluded product module and upstream Office/PDF runtime packages.
 *
 * One id now asserts the opposite. The important design decision is that it
 * checks the *derived shipped sets* on each surface, never a raw text search for
 * the excluded names. A text search cannot work here: `packages/runtime/src/index.ts`
 * deletes `@penglai/office` from the profile dependency list and
 * `packages/plugin-center/src/dsh-client.js` hides its product card, so the
 * correct implementation is required to mention each excluded id by name. Any
 * check that reported those filenames as a violation would be wrong, and any
 * check that allow-listed them by path would be a whitelist that rots.
 *
 * Surfaces that exist only after a native package build (`dist/runtime-staging*`)
 * report INCOMPLETE rather than PASS. Claiming a staged payload is clean when no
 * payload was staged would be the same dishonesty the old ids produced. The
 * payload copied back out of a collected installer counts as a staged payload:
 * it is the shipped bytes, not a rebuilt tree.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");

/** Penglai-scoped modules this version excludes from workspace, profile and runtime. */
export const EXCLUDED_PENGLAI_MODULES = [
  "@penglai/office",
] as const;

/**
 * Upstream DSH packages the runtime closure and product SBOM must drop.
 *
 * Kept separate from `EXCLUDED_DSH_RUNTIME_PACKAGES` in `scripts/lib/dsh-closure.mjs`
 * on purpose: that set is the implementation's own declaration, and asserting a
 * derived set against the declaration it was derived from would be circular. This
 * is the acceptance-side requirement, and `scripts/lib/dsh-closure.test.mjs`
 * asserts the two agree.
 */
export const REQUIRED_EXCLUDED_UPSTREAM_PACKAGES = [
  "@deepseek-ai/dsh-office-to-pdf",
  "@deepseek-ai/dsh-skill-office",
  "@deepseek-ai/dsh-client-ui-sidebar-documentpreview",
  "@deepseek-ai/libreoffice-kit",
] as const;

export interface SurfaceCheck {
  /** What was inspected. */
  surface: string;
  /** File or directory the set was derived from. */
  source: string;
  /** How many shipped entries were derived. */
  size: number;
  /** True when the surface was producible on this machine. */
  available: boolean;
  /** Excluded ids that survived into the derived shipped set. */
  leaked: string[];
}

function readJson<T>(rel: string): T | undefined {
  const path = join(ROOT, rel);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Surface 1: the product pnpm workspace membership list. */
export function inspectWorkspaceMembership(): SurfaceCheck {
  const rel = "pnpm-workspace.yaml";
  const path = join(ROOT, rel);
  const base: SurfaceCheck = { surface: "workspace", source: rel, size: 0, available: false, leaked: [] };
  if (!existsSync(path)) return base;
  const lines = readFileSync(path, "utf8").split("\n");
  // `- '!packages/office'` removes a directory from the workspace.
  const negations = lines
    .map((line) => /^\s*-\s*'!([^']+)'\s*$/.exec(line)?.[1])
    .filter((v): v is string => Boolean(v));
  const excludedDirs = new Set(negations.map((n) => n.replace(/^packages\//, "")));
  const leaked: string[] = [];
  for (const module of EXCLUDED_PENGLAI_MODULES) {
    const short = module.replace("@penglai/", "");
    // A leak is a package directory that is present on disk and NOT negated out
    // of the workspace. A directory that is absent is also fine: it means the
    // excluded module was removed rather than merely unlisted.
    if (existsSync(join(ROOT, "packages", short)) && !excludedDirs.has(short)) {
      leaked.push(module);
    }
  }
  return { ...base, size: negations.length, available: true, leaked };
}

/** Surface 2: the seeded DSH profile's plugin dependency list. */
export function inspectProfileSeed(): SurfaceCheck {
  const rel = "profile-seed/web/package.json";
  const base: SurfaceCheck = { surface: "profile", source: rel, size: 0, available: false, leaked: [] };
  const manifest = readJson<{ dependencies?: Record<string, string> }>(rel);
  if (!manifest) return base;
  const deps = Object.keys(manifest.dependencies ?? {});
  const leaked = EXCLUDED_PENGLAI_MODULES.filter((m) => deps.includes(m));
  // The seeded profile must also not re-introduce the image-size stub, which the
  // runtime deletes for the same reason Office is deleted.
  if (deps.includes("@penglai/image-size-disabled")) leaked.push("@penglai/image-size-disabled");
  return { ...base, size: deps.length, available: true, leaked: [...leaked] };
}

/** Surface 3: the shipped first-party plugin metadata the product ships. */
export function inspectShippedPluginMetadata(): SurfaceCheck {
  const rel = "packages/runtime/src/plugin-catalog.ts";
  const base: SurfaceCheck = { surface: "shipped-plugin-metadata", source: rel, size: 0, available: false, leaked: [] };
  if (!existsSync(join(ROOT, rel))) return base;
  const source = readFileSync(join(ROOT, rel), "utf8");
  const ids = [...source.matchAll(/id:\s*"(@[^"]+)"/g)].map((m) => m[1]!);
  const leaked = EXCLUDED_PENGLAI_MODULES.filter((m) => ids.includes(m));
  return { ...base, size: new Set(ids).size, available: true, leaked: [...leaked] };
}

/**
 * Surface 4: the installer payload manifest.
 *
 * `dist/runtime-staging*` is produced by a native package build, so on a
 * source-only machine this surface is unavailable and the assertion records
 * INCOMPLETE. That is the honest verdict: it is not a pass and not a failure.
 *
 * The publishing host runs no package build, so it has no staging tree — but it
 * does hold the payload it copied back out of the collected installer, and the
 * manifest inside that application describes the same shipped files. Inspecting
 * it is what keeps this surface available where the release is judged, instead of
 * recording INCOMPLETE for a payload the host is holding.
 *
 * `files` is a list of `{path, sha256, size}` objects, not names. Reading them as
 * names made the derived set hold objects, so every `includes` test was false and
 * the surface reported a clean payload no matter what it contained.
 */
export function installerPayloadNames(manifest: { packages?: unknown; files?: unknown }): Set<string> {
  const names = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === "string") names.add(value);
  };
  const packages = Array.isArray(manifest.packages) ? manifest.packages : [];
  for (const entry of packages) add(entry);
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  for (const entry of files) {
    add(entry);
    if (entry && typeof entry === "object") {
      const row = entry as { path?: unknown; name?: unknown };
      add(row.path);
      add(row.name);
    }
  }
  return names;
}

export function inspectInstallerPayload(): SurfaceCheck {
  const staged = [
    "dist/runtime-staging",
    "dist/runtime-staging-darwin-aarch64",
    "dist/runtime-staging-win32-x86_64",
  ].map((rel) => `${rel}/runtime-manifest.json`);
  const distDir = join(ROOT, "dist");
  const fromInstaller = existsSync(distDir)
    ? readdirSync(distDir)
        .filter((entry) => /^Penglai-v.+-from-dmg$/.test(entry))
        .map((entry) => `dist/${entry}/Penglai.app/Contents/Resources/runtime-manifest.json`)
    : [];
  for (const rel of [...staged, ...fromInstaller]) {
    if (!existsSync(join(ROOT, rel))) continue;
    const manifest = readJson<{ packages?: unknown; files?: unknown }>(rel);
    if (!manifest) continue;
    const names = installerPayloadNames(manifest);
    const leaked = [...EXCLUDED_PENGLAI_MODULES, ...REQUIRED_EXCLUDED_UPSTREAM_PACKAGES].filter(
      (m) => names.has(m) || [...names].some((n) => n.includes(m)),
    );
    return { surface: "installer-payload", source: rel, size: names.size, available: true, leaked };
  }
  return { surface: "installer-payload", source: "dist/runtime-staging*/runtime-manifest.json", size: 0, available: false, leaked: [] };
}

/**
 * Surface 5: the product SBOM.
 *
 * The SBOM is generated during supply-chain assembly from the lockfile, minus the
 * excluded runtime cohort. Absent a generated SBOM this surface is unavailable and
 * the assertion records INCOMPLETE rather than pretending the lockfile is the SBOM.
 */
export function inspectProductSbom(): SurfaceCheck {
  const rel = "evidence/generated/sbom.json";
  const base: SurfaceCheck = { surface: "product-sbom", source: rel, size: 0, available: false, leaked: [] };
  const bom = readJson<{ components?: { name?: string }[] }>(rel);
  if (!bom?.components) return base;
  const names = new Set(bom.components.map((c) => String(c.name ?? "")));
  const leaked = [...EXCLUDED_PENGLAI_MODULES, ...REQUIRED_EXCLUDED_UPSTREAM_PACKAGES].filter((m) =>
    names.has(m),
  );
  return { ...base, size: names.size, available: true, leaked: [...leaked] };
}

/** Surface 6: the product-path files that must stay clean of forbidden packages. */
export function inspectProductPathFiles(): SurfaceCheck {
  const base: SurfaceCheck = { surface: "product-path-files", source: PRODUCT_PATH_FILES.join(","), size: 0, available: true, leaked: [] };
  const leaked: string[] = [];
  let inspected = 0;
  for (const rel of PRODUCT_PATH_FILES) {
    const path = join(ROOT, rel);
    if (!existsSync(path)) continue;
    inspected += 1;
    const text = readFileSync(path, "utf8");
    for (const module of EXCLUDED_PENGLAI_MODULES) if (text.includes(module)) leaked.push(`${rel}:${module}`);
  }
  return { ...base, size: inspected, available: inspected > 0, leaked };
}

export function inspectExcludedScopeAbsence(): SurfaceCheck[] {
  return [
    inspectWorkspaceMembership(),
    inspectProfileSeed(),
    inspectShippedPluginMetadata(),
    inspectInstallerPayload(),
    inspectProductSbom(),
    inspectProductPathFiles(),
  ];
}

test("R50-ABSENT-001 no excluded module survives into any derived shipped set", () => {
  const surfaces = inspectExcludedScopeAbsence();
  const failed = surfaces.filter((s) => s.leaked.length > 0);
  const unavailable = surfaces.filter((s) => !s.available).map((s) => s.surface);
  const status = failed.length > 0 ? "FAIL" : unavailable.length > 0 ? "INCOMPLETE" : "PASS";
  recordAssertion({
    acceptanceId: "R50-ABSENT-001",
    runnerId: "exclusion",
    testId: "excluded-scope-absence",
    assertionId: "excluded-modules-absent-from-derived-sets",
    status,
    candidateSourceSha: declaredSourceSha(),
    exitCode: status === "PASS" ? 0 : 1,
    details: {
      safe:
        `${surfaces.length} surface(s): ` +
        surfaces.map((s) => `${s.surface}(${s.available ? s.size : "n/a"})`).join(" ") +
        (failed.length > 0 ? `; leaked ${failed.map((f) => `${f.surface}=${f.leaked.join("+")}`).join(",")}` : "") +
        (unavailable.length > 0 ? `; unavailable-without-native-build: ${unavailable.join(",")}` : ""),
    },
  });
  assert.deepEqual(
    failed.map((f) => f.surface),
    [],
    "excluded modules must not survive into a derived shipped set",
  );
});
