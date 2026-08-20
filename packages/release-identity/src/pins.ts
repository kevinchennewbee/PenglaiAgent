export const PRODUCT_NAME = "Penglai";
export const PRODUCT_VERSION = "0.5.0";
export const CANDIDATE_KIND = "public-publication-candidate";
export const TRUST_TIER = "community-verified";
export const GENERATION_ID = "penglai-dsh-v0.5";
export const IDENTITY_PHASE_UNFROZEN = "UNFROZEN";
export const SIGNATURE_KIND = "adhoc";
export const MINIMUM_MACOS = "13.0";
export const PINNED_NODE = "22.22.2";
export const PINNED_NODE_VERSION_PREFIX = "v22.22.2";
export const PINNED_PNPM = "10.14.0";
export const PINNED_TYPESCRIPT = "5.9.2";
export const PINNED_ELECTRON = "43.4.0";
export const PINNED_ELECTRON_DARWIN_ARM64_SHA256 =
  "827f9f182566f46846377575b51c547b9926b111637313a373b6f717462aebac";
export const PINNED_DSH = "0.1.0-rc.8";
export const PINNED_DSH_COMMIT = "141eb6fef83422698aef7a981029e843e8161534";
export const PINNED_DSH_INTEGRITY =
  "sha512-VQU5NlomrKLRgcXuOf+sxWFvqxPA8q9vMhrKPlPPXiOJEhGlGlAdiyxZvZxkCVI+v0zbhe21cY3/luLyxpSzzA==";
export const PINNED_LARK_SDK = "1.73.0";
export const PINNED_LARK_COMMIT = "f54b49f3566c52b54c598194b7ed3015e3e24224";
export const PINNED_WEIXIN_REF = "2.4.6";
export const PINNED_WEIXIN_COMMIT = "cef0bfc390393f716903e16d50408118047f87e0";
export const PINNED_SHERPA_ONNX = "1.13.5";
export const PINNED_SHERPA_ONNX_INTEGRITY =
  "sha512-kq3HgrXdbYCgK44U0gd2Cpnahf7qa59caPnROI7dy1+nKou8KdAsV9yUsCScZqTewvRyR/khUS97X26KE4JRMw==";
export const PINNED_ONNXRUNTIME_NODE = "1.27.0";
export const PINNED_ONNXRUNTIME_NODE_INTEGRITY =
  "sha512-QEzGwrvNBgv4uPVdnbHsOGG4G6T96mdlcFI8aAKPjMU8wOPpVocPXb6k3QGkaZagVTv2G9Bnnbo6Z3JdXr1fQw==";
export const PINNED_SENTENCEPIECE_JS = "1.1.0";
export const PINNED_SENTENCEPIECE_JS_INTEGRITY =
  "sha512-HN6teKCRO9tz37zbaNI3i+vMZ/JRWDt6kmZ7OVpzQv1jZHyYNmf5tE7CFpIYN86+y9TLB0cuscMdA3OHhT/MhQ==";
export const PINNED_SILK_WASM = "3.7.1";
export const PINNED_SILK_WASM_INTEGRITY =
  "sha512-mXPwLRtZxrYV3TZx41jMAeKc80wvmyrcXIcs8HctFxK15Ahz2OJQENYhNgEPeCEOdI6Mbx1NxQsqxzwc3DKerw==";
export const PINNED_LIBOPUS_WASM = "0.2.0";
export const PINNED_LIBOPUS_WASM_COMMIT = "55fe0b6faf9043518b7e1a7ea32e74659ecfbae7";
export const PINNED_LIBOPUS_WASM_INTEGRITY =
  "sha512-x/2Gu1/C6L3IICY09zyfp984AWiOYjn53u4WfdY3yh+3KTzMN8Xkm77q3lenWMVIk5SnSzjGEkQT+VQMFHLBHQ==";
export const PINNED_MOSS_TTS_COMMIT = "cc7bdf19c7639c0870dab22045a33b442760f6be";
export const PINNED_MOSS_RUNTIME_COMMIT = "c3b2333b88e0f062ca49d403540a169609354d93";
export const PINNED_MOSS_RUNTIME_SHA256 =
  "b49d214bbe9ba9849d48e1588c66a70173eee76c211bb4f473b5eadf7bce038c";
export const PINNED_MOSS_TTS_MODEL_REVISION = "f52645cb467506d8e18e746ddd59482685b74e58";
export const PINNED_MOSS_CODEC_MODEL_REVISION = "ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae";
export const PINNED_MOSS_MODEL_BUNDLE_REVISION = "cd877ae87fed8f9d26c237c5038242e796e51389";
export const PINNED_SHERPA_UPSTREAM_COMMIT = "3e409338959097c6518998c9b72757db257f5f6f";
export const PROFILE_SCHEMA = 3;
export const CATALOG_SCHEMA = 2;
export const IM_SCHEMA = 3;
export const ACCEPTANCE_DOC = "docs/ACCEPTANCE.md";
export const HARD_ID_RE = /\| `(R50-[A-Z0-9]+-\d+)` \|/g;
/** Previous registry generation. Never a completion map. */
export const LEGACY_HARD_COUNT_STALE = 202;
export const REQUIRED_HARD_FAMILIES = [
  { prefix: "R50-VOICE", start: 1, end: 16 },
  { prefix: "R50-CTXMEM", start: 1, end: 16 },
  { prefix: "R50-BUDGET", start: 1, end: 6 },
  { prefix: "R50-COMP", start: 1, end: 8 },
  { prefix: "R50-LIVE", start: 9, end: 16 },
] as const;
export const GITHUB_ACTIONS_STATUS = "UNAVAILABLE";
export const CANDIDATE_SOURCE_SHA_NONE = "NONE";
export const UPDATER_CHANNEL = "desktop-v0.5";

export const PUBLICATION_TARGET = Object.freeze({
  repo: "kevinchennewbee/PenglaiAgent",
  tag: "v0.5.0",
  release: "v0.5.0",
  channel: "NOT_PUBLISHED_0_5_0",
});

export const RELEASE_TARGETS = [
  {
    key: "darwin-aarch64",
    platform: "darwin",
    arch: "arm64",
    installer: "Penglai_0.5.0_macos_aarch64.dmg",
  },
] as const;

export type ReleaseTargetKey = (typeof RELEASE_TARGETS)[number]["key"];

export const HARD_SUBGATES = [
  { name: "format:check", kind: "format", mode: "run" },
  { name: "typecheck", kind: "type", mode: "run" },
  { name: "test:unit", kind: "unit", mode: "run" },
  { name: "test:contract", kind: "contract", mode: "run" },
  { name: "test:integration", kind: "integration", mode: "run" },
  { name: "test:security", kind: "security", mode: "run" },
  { name: "test:chaos", kind: "chaos", mode: "run" },
  { name: "test:soak", kind: "soak", mode: "run" },
  { name: "verify:versions", kind: "contract", mode: "run" },
  { name: "verify:identity", kind: "contract", mode: "run" },
  { name: "verify:contracts", kind: "contract", mode: "run" },
  { name: "verify:dependencies", kind: "contract", mode: "run" },
  { name: "verify:closure", kind: "closure", mode: "run" },
  { name: "verify:profile", kind: "profile", mode: "run" },
  { name: "verify:artifact", kind: "artifact", mode: "run" },
  { name: "verify:fuses", kind: "fuses", mode: "run" },
  { name: "verify:signing", kind: "signing", mode: "run" },
  { name: "verify:installed", kind: "installed", mode: "evidence" },
  { name: "verify:live", kind: "live", mode: "evidence" },
  { name: "verify:public-export", kind: "public-export", mode: "evidence" },
  { name: "verify:soak", kind: "soak", mode: "evidence" },
  { name: "verify:evidence", kind: "evidence", mode: "run" },
  { name: "audit:secrets", kind: "secret", mode: "run" },
] as const;

export const REQUIRED_SUBGATE_KINDS = [
  "format",
  "type",
  "unit",
  "contract",
  "integration",
  "security",
  "chaos",
  "soak",
  "closure",
  "profile",
  "artifact",
  "fuses",
  "signing",
  "evidence",
  "installed",
  "live",
  "public-export",
  "secret",
] as const;

export const FORBIDDEN_READY_STATES = [
  "READY",
  "READY_FOR_CODEX_0_5_ACCEPTANCE",
  "CODEX_PASS",
  "RELEASE_APPROVED",
  "PUBLICATION_APPROVED",
  "PUBLISHED",
] as const;

export const FORBIDDEN_PRODUCT_PACKAGES = [
  "@penglai/credentials-keychain",
  "@penglai/plugin-smoke",
] as const;

export const USER_CATALOG_PACKAGES = [
  "@penglai/plugin-center",
  "@penglai/im",
  "@penglai/asr",
  "@penglai/moss-tts",
  "@penglai/context",
  "@penglai/memory",
  "@penglai/budget",
  "@penglai/companion",
  "@penglai/plugin-reference",
] as const;

export const STALE_ARTIFACTS = [
  {
    id: "alpha3-release-info-artifact",
    pathSuffix: "Penglai_0.2.0-alpha.3_macos_aarch64",
    sha256: "c19e393e5d9b85190e60286e4fca30dbeb242799013baf605cf3615782683c79",
    sourceSha: "ba5ba3dd65602a30a4b9fb815472d9abdc4805e5",
    reason: "STALE_INVALIDATED alpha.3 local-acceptance, not 0.5.0",
  },
  {
    id: "alpha3-plan-input",
    pathSuffix: "penglai-v0.2.0-alpha.3",
    sha256: "",
    sourceSha: "3e4c88cc7c8530403c4699df4dc50485e32d69ca",
    reason: "STALE_INVALIDATED planning-input SHA cannot freeze 0.5 artifacts",
  },
  {
    id: "alpha2-local-dmg",
    pathSuffix: "dist/Penglai_0.2.0_macos_aarch64.dmg",
    sha256: "8c31fac644ed4042bf5091fb72a9655d087827483a3801f7364b3b1fe5a3af3f",
    sourceSha: "6c2183f519dddf9014b454955476994580341500",
    reason: "STALE_INVALIDATED alpha.2 Keychain/IM skeleton, not 0.5.0",
  },
  {
    id: "phantom-ee28dafd",
    sha256: "ee28dafdddca543d8af9ac423b3328da544c0b3236322aaee73db78edb053f2e",
    sourceSha: "",
    reason: "historical STATE hash that never matched a current candidate",
  },
] as const;

export const STALE_PATH_MARKERS = [
  "Penglai_0.2.0_macos_aarch64.dmg",
  "Penglai_0.2.0-alpha.3_macos_aarch64.dmg",
  "Penglai-v0.2.0-alpha.3-arm64",
  "penglai-v0.2.0-alpha.3",
] as const;
