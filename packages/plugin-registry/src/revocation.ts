import { PenglaiError } from "@penglai/contracts";
import type { CatalogRevocation, SignedPluginCatalog } from "./catalog-schema.js";

export function revocationsFor(
  catalog: SignedPluginCatalog,
  id: string,
  version: string,
  sha256: string,
): CatalogRevocation[] {
  return catalog.revocations.filter(
    (row) => row.id === id && row.version === version && row.sha256 === sha256,
  );
}

export function assertInstallAllowed(
  catalog: SignedPluginCatalog,
  id: string,
  version: string,
  sha256: string,
): void {
  const hits = revocationsFor(catalog, id, version, sha256);
  if (hits.some((row) => row.severity === "critical")) {
    throw new PenglaiError("SECURITY_POLICY", `${id}@${version} is critically revoked`);
  }
}

export function shouldDisableOnBoot(
  catalog: SignedPluginCatalog,
  id: string,
  version: string,
  sha256: string,
): boolean {
  return revocationsFor(catalog, id, version, sha256).some((row) => row.severity === "critical");
}
