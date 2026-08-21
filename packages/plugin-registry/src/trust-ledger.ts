import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PenglaiError } from "@penglai/contracts";

export interface TrustState {
  schema: 1;
  kind: "plugin-catalog" | "app-update";
  highestSequence: number;
  highestKeyEpoch: number;
  lastDigest: string;
  lastTag?: string;
}

export function readTrustState(path: string): TrustState | undefined {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as TrustState;
    if (raw.schema !== 1) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

export function acceptMonotonic(input: {
  path: string;
  kind: TrustState["kind"];
  sequence: number;
  keyEpoch: number;
  digest: string;
  tag?: string;
}): TrustState {
  if (!/^[0-9a-f]{64}$/.test(input.digest)) throw new PenglaiError("SECURITY_POLICY", "trust digest");
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new PenglaiError("SECURITY_POLICY", "trust sequence");
  }
  const prior = readTrustState(input.path);
  if (prior && prior.kind !== input.kind) throw new PenglaiError("SECURITY_POLICY", "trust kind mismatch");
  if (prior && input.sequence < prior.highestSequence) {
    throw new PenglaiError("SECURITY_POLICY", "catalog/update sequence rollback");
  }
  if (prior && input.sequence === prior.highestSequence && input.digest !== prior.lastDigest) {
    throw new PenglaiError("SECURITY_POLICY", "same sequence with a different digest");
  }
  if (prior && input.keyEpoch < prior.highestKeyEpoch) {
    throw new PenglaiError("SECURITY_POLICY", "signing key epoch rollback");
  }
  const next: TrustState = {
    schema: 1,
    kind: input.kind,
    highestSequence: input.sequence,
    highestKeyEpoch: Math.max(prior?.highestKeyEpoch ?? 0, input.keyEpoch),
    lastDigest: input.digest,
    ...(input.tag ? { lastTag: input.tag } : {}),
  };
  mkdirSync(dirname(input.path), { recursive: true, mode: 0o700 });
  const tmp = `${input.path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next)}\n`, { mode: 0o600 });
  renameSync(tmp, input.path);
  return next;
}

export function contentAddressedPath(root: string, sha256: string, ext: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new PenglaiError("SECURITY_POLICY", "content address");
  return join(root, `${sha256}${ext}`);
}
