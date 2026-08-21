export * from "./canonical-json.js";
export * from "./signature.js";
export * from "./catalog-schema.js";
export * from "./catalog-artifact.js";
export * from "./release-discovery.js";
export * from "./download.js";
export * from "./archive-policy.js";
export * from "./trust-ledger.js";
export * from "./revocation.js";
export * from "./app-update.js";
export * from "./embedded-keys.js";
export * from "./host.js";
export * from "./tar.js";

import { createHash } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import { canonicalizeBytes } from "./canonical-json.js";
import { decodeDetachedSignature, verifyBytes } from "./signature.js";
import { parseSignedPluginCatalog, type SignedPluginCatalog } from "./catalog-schema.js";

export function verifySignedCatalog(input: {
  json: unknown;
  signature: Buffer;
  publicKeyHex: string;
  signingKeyId: string;
  nowMs?: number;
}): { catalog: SignedPluginCatalog; digest: string } {
  const bytes = canonicalizeBytes(input.json);
  verifyBytes(bytes, decodeDetachedSignature(input.signature), input.publicKeyHex);
  const catalog = parseSignedPluginCatalog(input.json, input.nowMs);
  if (catalog.signingKeyId !== input.signingKeyId) {
    throw new PenglaiError("SECURITY_POLICY", "catalog signingKeyId does not match embedded public key id");
  }
  return { catalog, digest: createHash("sha256").update(bytes).digest("hex") };
}
