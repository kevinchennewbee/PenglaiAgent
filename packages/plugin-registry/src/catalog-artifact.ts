import { PenglaiError } from "@penglai/contracts";

export function selectCatalogArtifact<T extends { target: string }>(
  artifacts: readonly T[],
  hostTarget: string,
): T {
  if (!hostTarget || typeof hostTarget !== "string") {
    throw new PenglaiError("INVALID_INPUT", "plugin host target required");
  }
  if (!Array.isArray(artifacts) || artifacts.length < 1) {
    throw new PenglaiError("INVALID_INPUT", "plugin artifacts missing");
  }
  const exact = artifacts.find((row) => row.target === hostTarget);
  if (exact) return exact;
  const any = artifacts.find((row) => row.target === "any");
  if (any) return any;
  throw new PenglaiError("INVALID_INPUT", `incompatible with target ${hostTarget}`);
}
