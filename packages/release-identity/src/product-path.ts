import { PenglaiError } from "@penglai/contracts";
import { FORBIDDEN_PRODUCT_PACKAGES, USER_CATALOG_PACKAGES } from "./pins.js";

export const PRODUCT_PATH_FILES = [
  "scripts/pack-plugins.mjs",
  "profile-seed/web/package.json",
  "profile-seed/web/cordis.patch.yml",
  "packages/plugin-center/src/index.ts",
] as const;

export function forbiddenProductHits(text: string): string[] {
  const hits: string[] = [];
  const inclusion = [
    /id:\s*["']@penglai\/credentials-keychain["']/,
    /dir:\s*["']packages\/credentials-keychain["']/,
    /"@penglai\/credentials-keychain"\s*:/,
    /name:\s*["']@penglai\/credentials-keychain["']/,
    /id:\s*["']@penglai\/plugin-smoke["']/,
    /dir:\s*["']packages\/plugin-smoke["']/,
    /"@penglai\/plugin-smoke"\s*:/,
    /name:\s*["']@penglai\/plugin-smoke["']/,
  ];
  const labels = [
    "@penglai/credentials-keychain",
    "@penglai/credentials-keychain",
    "@penglai/credentials-keychain",
    "@penglai/credentials-keychain",
    "@penglai/plugin-smoke",
    "@penglai/plugin-smoke",
    "@penglai/plugin-smoke",
    "@penglai/plugin-smoke",
  ];
  for (let i = 0; i < inclusion.length; i += 1) {
    const re = inclusion[i];
    const label = labels[i];
    if (re && label && re.test(text) && !hits.includes(label)) hits.push(label);
  }
  return hits;
}

export function assertProductPathClean(files: Record<string, string>): void {
  const bad: string[] = [];
  for (const [rel, text] of Object.entries(files)) {
    for (const hit of forbiddenProductHits(text)) {
      bad.push(`${rel}:${hit}`);
    }
  }
  if (bad.length) {
    throw new PenglaiError("SECURITY_POLICY", `forbidden product-path package ${bad.join(",")}`);
  }
}

export function assertUserCatalogAllowlist(ids: string[]): void {
  for (const id of ids) {
    if ((FORBIDDEN_PRODUCT_PACKAGES as readonly string[]).includes(id)) {
      throw new PenglaiError("SECURITY_POLICY", `catalog contains forbidden ${id}`);
    }
  }
  for (const required of USER_CATALOG_PACKAGES) {
    if (!ids.includes(required)) {
      throw new PenglaiError("INVALID_INPUT", `user catalog missing ${required}`);
    }
  }
}

export function historicalClassification(pkgName: string): "historical/not-product" | "product" {
  if ((FORBIDDEN_PRODUCT_PACKAGES as readonly string[]).includes(pkgName)) return "historical/not-product";
  return "product";
}
