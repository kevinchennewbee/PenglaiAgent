import { PenglaiError } from "@penglai/contracts";
import { RELEASE_TARGETS, type ReleaseTargetKey } from "./pins.js";

export interface HostPreflight {
  platform: "darwin" | "win32" | "linux" | string;
  arch: "arm64" | "x64" | string;
  native: boolean;
  translated?: boolean;
  emulated?: boolean;
}

export interface TargetPreflight {
  target: ReleaseTargetKey;
  verdict: "READY" | "BLOCKED";
  reason?: string;
  canCrossPackage: boolean;
  nativeEvidenceAllowed: boolean;
}

export function evaluateTargetPreflight(host: HostPreflight, target: ReleaseTargetKey): TargetPreflight {
  const spec = RELEASE_TARGETS.find((t) => t.key === target);
  if (!spec) throw new PenglaiError("INVALID_INPUT", `unknown target ${target}`);
  const sameOs = host.platform === spec.platform;
  const sameArch = host.arch === spec.arch;
  if (host.translated || host.emulated) {
    return {
      target,
      verdict: "BLOCKED",
      reason: "translated/emulated host cannot produce native evidence",
      canCrossPackage: sameOs,
      nativeEvidenceAllowed: false,
    };
  }
  if (sameOs && sameArch && host.native) {
    return {
      target,
      verdict: "READY",
      canCrossPackage: true,
      nativeEvidenceAllowed: true,
    };
  }
  return {
    target,
    verdict: "BLOCKED",
    reason: `host ${host.platform}/${host.arch} cannot native-build ${target}`,
    canCrossPackage: sameOs,
    nativeEvidenceAllowed: false,
  };
}

export function assertNoFakeArtifact(preflight: TargetPreflight, producedNativeFlag: boolean): void {
  if (preflight.verdict === "BLOCKED" && producedNativeFlag) {
    throw new PenglaiError("SECURITY_POLICY", `${preflight.target} BLOCKED host claimed native artifact`);
  }
}
