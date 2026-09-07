import { PenglaiError } from "@penglai/contracts";
import {
  PINNED_DSH,
  PINNED_DSH_COMMIT,
  PINNED_DSH_CLOSURE_MANIFEST_SHA256,
  PINNED_DSH_CLOSURE_PACKAGE_COUNT,
  PINNED_DSH_TAG,
  PINNED_DSH_TARBALL_SHA256,
  PINNED_ELECTRON,
  PINNED_NODE,
  PINNED_PNPM,
  PRODUCT_VERSION,
  PINNED_LARK_COMMIT,
  PINNED_LARK_SDK,
  PINNED_LIBOPUS_WASM,
  PINNED_LIBOPUS_WASM_COMMIT,
  PINNED_LIBOPUS_WASM_INTEGRITY,
  PINNED_MOSS_CODEC_MODEL_REVISION,
  PINNED_MOSS_MODEL_BUNDLE_REVISION,
  PINNED_MOSS_RUNTIME_COMMIT,
  PINNED_MOSS_RUNTIME_SHA256,
  PINNED_MOSS_TTS_COMMIT,
  PINNED_MOSS_TTS_MODEL_REVISION,
  PINNED_ONNXRUNTIME_NODE,
  PINNED_ONNXRUNTIME_NODE_INTEGRITY,
  PINNED_SHERPA_ONNX,
  PINNED_SHERPA_ONNX_INTEGRITY,
  PINNED_SHERPA_UPSTREAM_COMMIT,
  PINNED_SENTENCEPIECE_JS,
  PINNED_SENTENCEPIECE_JS_INTEGRITY,
  PINNED_SILK_WASM,
  PINNED_SILK_WASM_INTEGRITY,
  PINNED_WEIXIN_COMMIT,
  PINNED_WEIXIN_REF,
  USER_CATALOG_PACKAGES,
} from "./pins.js";

export type MigrationDecision = "DSH_REUSE" | "PENGLAI_PLUGIN" | "DISTRIBUTION" | "REJECT_DUPLICATE";

export const MIGRATION_LEDGER = [
  { capability: "Workspace/Session/Turn", needle: "Workspace/Session", decision: "DSH_REUSE" },
  { capability: "Goal/Todo/Skills/MCP/Web/Attachments/Schedule/TokenMeter", needle: "Schedule/TokenMeter", decision: "DSH_REUSE" },
  { capability: "Pi Models/BYOK", needle: "Pi model", decision: "DSH_REUSE" },
  { capability: "Weixin/Feishu IM", needle: "微信/飞书", decision: "PENGLAI_PLUGIN" },
  { capability: "SenseVoice ASR", needle: "SenseVoice ASR", decision: "PENGLAI_PLUGIN" },
  { capability: "MOSS-TTS-Nano", needle: "MOSS-TTS-Nano", decision: "PENGLAI_PLUGIN" },
  { capability: "Penglai Memory with authorized sources", needle: "@penglai/memory", decision: "PENGLAI_PLUGIN" },
  { capability: "Budget", needle: "budget", decision: "PENGLAI_PLUGIN" },
  { capability: "Companion", needle: "companionship", decision: "PENGLAI_PLUGIN" },
  { capability: "install/update/uninstall", needle: "安装更新卸载", decision: "DISTRIBUTION" },
  { capability: "0.4.1 Host/EpisodeRunner", needle: "EpisodeRunner", decision: "REJECT_DUPLICATE" },
] as const satisfies readonly { capability: string; needle: string; decision: MigrationDecision }[];

export const VOICE_NATIVE_BUBBLE = {
  weixin: "capability-probe-only",
  feishu: "official-audio-hard",
} as const;

export function freezePins() {
  return {
    dsh: PINNED_DSH,
    dshCommit: PINNED_DSH_COMMIT,
    dshTarballSha256: PINNED_DSH_TARBALL_SHA256,
    dshClosureManifestSha256: PINNED_DSH_CLOSURE_MANIFEST_SHA256,
    electron: PINNED_ELECTRON,
    node: PINNED_NODE,
    weixinRef: PINNED_WEIXIN_REF,
    weixinCommit: PINNED_WEIXIN_COMMIT,
    larkSdk: PINNED_LARK_SDK,
    larkCommit: PINNED_LARK_COMMIT,
    sherpa: PINNED_SHERPA_ONNX,
    sherpaIntegrity: PINNED_SHERPA_ONNX_INTEGRITY,
    sherpaCommit: PINNED_SHERPA_UPSTREAM_COMMIT,
    onnxruntime: PINNED_ONNXRUNTIME_NODE,
    onnxruntimeIntegrity: PINNED_ONNXRUNTIME_NODE_INTEGRITY,
    sentencepiece: PINNED_SENTENCEPIECE_JS,
    sentencepieceIntegrity: PINNED_SENTENCEPIECE_JS_INTEGRITY,
    silk: PINNED_SILK_WASM,
    silkIntegrity: PINNED_SILK_WASM_INTEGRITY,
    libopus: PINNED_LIBOPUS_WASM,
    libopusCommit: PINNED_LIBOPUS_WASM_COMMIT,
    libopusIntegrity: PINNED_LIBOPUS_WASM_INTEGRITY,
    mossCommit: PINNED_MOSS_TTS_COMMIT,
    mossRuntimeCommit: PINNED_MOSS_RUNTIME_COMMIT,
    mossRuntimeSha256: PINNED_MOSS_RUNTIME_SHA256,
    mossTtsModelRevision: PINNED_MOSS_TTS_MODEL_REVISION,
    mossCodecModelRevision: PINNED_MOSS_CODEC_MODEL_REVISION,
    mossModelBundleRevision: PINNED_MOSS_MODEL_BUNDLE_REVISION,
    catalog: [...USER_CATALOG_PACKAGES],
    voiceNativeBubble: VOICE_NATIVE_BUBBLE,
  };
}

export function assertSourcesDocPins(sourcesMd: string, voiceMd: string): void {
  const pins = freezePins();
  const docs = `${sourcesMd}\n${voiceMd}`;
  const required = [
    pins.dsh,
    pins.dshCommit,
    pins.dshTarballSha256,
    pins.dshClosureManifestSha256,
    pins.weixinRef,
    pins.weixinCommit,
    pins.larkSdk,
    pins.larkCommit,
    pins.sherpa,
    pins.onnxruntime,
    pins.sentencepiece,
    pins.silk,
    pins.libopus,
    pins.libopusCommit,
    pins.mossCommit,
    pins.mossRuntimeCommit,
    pins.mossRuntimeSha256,
    pins.mossTtsModelRevision,
    pins.mossCodecModelRevision,
    pins.mossModelBundleRevision,
  ];
  for (const token of required) {
    if (!docs.includes(token)) {
      throw new PenglaiError("DSH_CONTRACT_DRIFT", `sources/voice docs missing pin ${token}`);
    }
  }
}

export function assertParityLedger(parityMd: string): void {
  for (const row of MIGRATION_LEDGER) {
    if (!parityMd.toLowerCase().includes(row.needle.toLowerCase())) {
      throw new PenglaiError("INVALID_INPUT", `parity ledger missing ${row.capability}`);
    }
    if (row.decision === "REJECT_DUPLICATE" && !/REJECT_DUPLICATE/.test(parityMd)) {
      throw new PenglaiError("INVALID_INPUT", "parity ledger missing REJECT_DUPLICATE");
    }
  }
}

export function assertNoLatestDownloads(text: string): void {
  const lower = text.toLowerCase();
  let unsafeLatestUrl = false;
  for (let cursor = lower.indexOf("latest"); cursor >= 0; cursor = lower.indexOf("latest", cursor + 6)) {
    let start = cursor;
    while (start > 0 && !/\s/.test(lower[start - 1] ?? "")) start -= 1;
    const token = lower.slice(start, cursor + 6);
    if (token.startsWith("http://") || token.startsWith("https://")) {
      unsafeLatestUrl = true;
      break;
    }
  }
  const documentedRefusal = ["拒绝", "禁止", "must not", "不得"].some((token) => lower.includes(token));
  if (unsafeLatestUrl && !documentedRefusal) {
    throw new PenglaiError("SECURITY_POLICY", "unqualified latest download URL");
  }
}

export const COHORT_FREEZE_KIND = "penglai-0.5.11-development-cohort-freeze" as const;
export const REJECTED_DSH_SUCCESSOR_TAG = "dsh-v0.1.3-alpha.1" as const;

export interface CohortFreezeRecord {
  schema: 1;
  kind: typeof COHORT_FREEZE_KIND;
  status: "development-frozen" | "publication-authorized";
  publicRelease: { productVersion: string; tag: string; immutable: true };
  previousPublicRelease?: { productVersion: string; tag: string; immutable: true };
  development: {
    versionLabel: "0.5.11";
    publicationAuthorized: boolean;
    identityRetitled: boolean;
  };
  dsh: {
    version: string;
    tag: string;
    commit: string;
    packageCount: number;
    tarballSha256: string;
    closureManifestSha256: string;
    rejectedSuccessor: { tag: string; reason: string };
  };
  runtime: { node: string; electron: string; pnpm: string };
  migration: {
    homeGeneration: string;
    center: string;
    windowsUpgrade: string;
    mixedDshGenerations: "forbidden";
  };
}

export function assertCohortFreeze(input: {
  freeze: CohortFreezeRecord;
  productVersion: string;
  releaseContract: {
    version: string;
    dshVersion: string;
    dshSource: { tag: string; commit: string; packageCount: number; closureManifestSha256?: string; cliTarballSha256?: string };
  };
}): void {
  const { freeze, productVersion, releaseContract } = input;
  const pins = freezePins();
  if (freeze.schema !== 1 || freeze.kind !== COHORT_FREEZE_KIND) {
    throw new PenglaiError("INVALID_INPUT", "cohort freeze identity");
  }
  if (freeze.status === "publication-authorized") {
    if (freeze.development.publicationAuthorized !== true || freeze.development.identityRetitled !== true) {
      throw new PenglaiError("SECURITY_POLICY", "publication-authorized freeze must retitle 0.5.11");
    }
    if (
      freeze.previousPublicRelease?.productVersion !== "0.5.10" ||
      freeze.previousPublicRelease.tag !== "v0.5.10" ||
      freeze.previousPublicRelease.immutable !== true
    ) {
      throw new PenglaiError("SECURITY_POLICY", "published 0.5.10 identity must stay immutable");
    }
  } else if (freeze.status === "development-frozen") {
    if (freeze.development.publicationAuthorized !== false || freeze.development.identityRetitled !== false) {
      throw new PenglaiError("SECURITY_POLICY", "0.5.11 identity retitle requires publication authorization");
    }
  } else {
    throw new PenglaiError("INVALID_INPUT", "cohort freeze identity");
  }
  if (freeze.publicRelease.immutable !== true) {
    throw new PenglaiError("SECURITY_POLICY", "current public identity must stay immutable once tagged");
  }
  if (
    freeze.publicRelease.productVersion !== PRODUCT_VERSION ||
    freeze.publicRelease.productVersion !== productVersion ||
    freeze.publicRelease.productVersion !== releaseContract.version ||
    freeze.publicRelease.tag !== `v${PRODUCT_VERSION}`
  ) {
    throw new PenglaiError("SECURITY_POLICY", "public release identity drifted from product freeze");
  }
  if (
    freeze.dsh.version !== pins.dsh ||
    freeze.dsh.tag !== PINNED_DSH_TAG ||
    freeze.dsh.commit !== pins.dshCommit ||
    freeze.dsh.packageCount !== PINNED_DSH_CLOSURE_PACKAGE_COUNT ||
    freeze.dsh.tarballSha256 !== pins.dshTarballSha256 ||
    freeze.dsh.closureManifestSha256 !== pins.dshClosureManifestSha256
  ) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "cohort freeze does not match pinned DSH identity");
  }
  if (
    freeze.dsh.version !== releaseContract.dshVersion ||
    freeze.dsh.tag !== releaseContract.dshSource.tag ||
    freeze.dsh.commit !== releaseContract.dshSource.commit ||
    freeze.dsh.packageCount !== releaseContract.dshSource.packageCount
  ) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "cohort freeze does not match release-contract DSH identity");
  }
  if (freeze.dsh.rejectedSuccessor.tag !== REJECTED_DSH_SUCCESSOR_TAG || !freeze.dsh.rejectedSuccessor.reason.trim()) {
    throw new PenglaiError("SECURITY_POLICY", "incomplete DSH successor must stay rejected");
  }
  if (
    freeze.runtime.node !== PINNED_NODE ||
    freeze.runtime.electron !== PINNED_ELECTRON ||
    freeze.runtime.pnpm !== PINNED_PNPM
  ) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "cohort freeze runtime pins drifted");
  }
  if (freeze.migration.mixedDshGenerations !== "forbidden") {
    throw new PenglaiError("SECURITY_POLICY", "mixed DSH generations must stay forbidden");
  }
  if (!freeze.migration.homeGeneration || !freeze.migration.center || !freeze.migration.windowsUpgrade) {
    throw new PenglaiError("INVALID_INPUT", "cohort freeze missing migration/rollback design");
  }
}
