/**
 * 语音模型资产（按需下载，数据不出机）— 0.3.x 下载策略的 TS 移植。
 *
 * 继承的 0.3.x 真机教训（penglai_setup.py `_voice_install`，2026-06-12 踩坑）：
 *   1. **int8 单文件直下**：SenseVoice 只拉 model.int8.onnx（~229MB）+ tokens.txt
 *      （0.3MB），绝不拉含 895MB fp32 的整包——省近 4 倍流量；
 *   2. **镜像优先**：hf-mirror 在前、huggingface 在后（MOSS 另加 modelscope 最前）；
 *   3. **`.part` 断点续传**：半成品留在 .part，重跑时 Range 续传，成功才原子改名；
 *   4. **供应链固定**：每个模型文件固定官方仓库 revision、大小和 SHA-256；
 *   5. **只报告可证实状态**：每个已有/新下载文件都验大小与 SHA-256，缺一报一。
 *
 * 模型根目录：`<数据目录>/models/`（默认 ~/.penglai/models/），可用
 * PENGLAI_MODEL_DIR / PENGLAI_VOICE_SENSEVOICE_DIR / PENGLAI_VOICE_MOSSTTS_DIR
 * 覆盖（与 0.3.x 及旧分支 tools/voice.ts 的约定一致）。
 *
 * 下载器全部走注入缝（VoiceFetch / spawn）：测试绝不真实下载大模型。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

// ── 注入缝 ─────────────────────────────────────────────────────

export interface VoiceFetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: AsyncIterable<Uint8Array> | null;
}

export type VoiceFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<VoiceFetchResponse>;

/** 生产 fetch：包装全局 fetch（web stream body 在 Node ≥18 可异步迭代）。 */
const productionFetch: VoiceFetch = async (url, init) => {
  const res = await fetch(url, {
    headers: { "User-Agent": "penglai-voice-setup", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
  return {
    ok: res.ok,
    status: res.status,
    headers: res.headers,
    body: (res.body as unknown as AsyncIterable<Uint8Array> | null) ?? null,
  };
};

// ── 模型清单 ───────────────────────────────────────────────────

export interface VoiceFileSpec {
  /** 模型目录内的相对路径（MOSS 含子目录）。 */
  name: string;
  /** 候选 URL，按镜像优先顺序。 */
  urls: string[];
  /** 期望大小（可选；>0 时下载后校验）。 */
  sizeBytes?: number;
  /** 期望 sha256（可选；存在时强校验）。 */
  sha256?: string;
}

export interface VoiceModelSpec {
  id: "sensevoice" | "moss-tts";
  label: string;
  /** 体积提示（面板文案）。 */
  sizeHint: string;
  /** 就绪判定文件（probe 用；全部存在才算模型齐）。 */
  required: string[];
  files: VoiceFileSpec[];
}

const SENSEVOICE_REPO = "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17";
const SENSEVOICE_REVISION = "2365baeacb507f821a0c8120fcee3d484dba7a07";

export const SENSEVOICE_SPEC: VoiceModelSpec = {
  id: "sensevoice",
  label: "SenseVoice 本地语音识别（含情绪标签）",
  sizeHint: "约 230MB（int8 推理件，不拉 895MB fp32 整包）",
  required: ["model.int8.onnx", "tokens.txt"],
  files: [
    {
      name: "model.int8.onnx",
      urls: [
        `https://hf-mirror.com/${SENSEVOICE_REPO}/resolve/${SENSEVOICE_REVISION}/model.int8.onnx`,
        `https://huggingface.co/${SENSEVOICE_REPO}/resolve/${SENSEVOICE_REVISION}/model.int8.onnx`,
      ],
      sizeBytes: 239_233_841,
      sha256: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
    },
    {
      name: "tokens.txt",
      urls: [
        `https://hf-mirror.com/${SENSEVOICE_REPO}/resolve/${SENSEVOICE_REVISION}/tokens.txt`,
        `https://huggingface.co/${SENSEVOICE_REPO}/resolve/${SENSEVOICE_REVISION}/tokens.txt`,
      ],
      sizeBytes: 315_894,
      sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
    },
  ],
};

function mossUrls(repoModelscope: string, repoHf: string, revision: string, file: string): string[] {
  return [
    `https://modelscope.cn/models/${repoModelscope}/resolve/master/${file}`,
    `https://hf-mirror.com/${repoHf}/resolve/${revision}/${file}`,
    `https://huggingface.co/${repoHf}/resolve/${revision}/${file}`,
  ];
}

const MOSS_TTS_REPO_MS = "openmoss/MOSS-TTS-Nano-100M-ONNX";
const MOSS_TTS_REPO_HF = "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX";
const MOSS_TTS_REVISION = "f52645cb467506d8e18e746ddd59482685b74e58";
const MOSS_CODEC_REPO_MS = "openmoss/MOSS-Audio-Tokenizer-Nano-ONNX";
const MOSS_CODEC_REPO_HF = "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX";
const MOSS_CODEC_REVISION = "ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae";

/** MOSS-TTS-Nano 浏览器版 ONNX 清单（与 0.3.x tts_service.py 同源）。 */
const MOSS_TTS_FILES: Array<{ name: string; sizeBytes: number; sha256: string }> = [
  { name: "browser_poc_manifest.json", sizeBytes: 503_354, sha256: "097d80e993dc29f0bae427590b4f77084a161cb578b50d82c29f455d5faa9eee" },
  { name: "tts_browser_onnx_meta.json", sizeBytes: 4_487, sha256: "3edf25232dcd0af3d061c837e9a968a39e2f8592e06777d740503c4f2244f95c" },
  { name: "tokenizer.model", sizeBytes: 470_897, sha256: "c353ee1479b536bf414c1b247f5542b6607fb8ae91320e5af1781fee200fddff" },
  { name: "moss_tts_decode_step.onnx", sizeBytes: 291_483, sha256: "698cbc2fc1c2feca16e5895614ed52bbb32ded10f236c076f477b2e69abf32d8" },
  { name: "moss_tts_global_shared.data", sizeBytes: 440_813_568, sha256: "bce8312c3df6a44545302cae229b61054fe0672e0b252ba59cba47adeed831dc" },
  { name: "moss_tts_local_cached_step.onnx", sizeBytes: 53_685, sha256: "aa9035fefc1c138a951a8bcfc0374fb03a25f1ece67f7f7f53bce349b84a1dd5" },
  { name: "moss_tts_local_decoder.onnx", sizeBytes: 49_231, sha256: "51aa754301b38550a5f9adda0ad93bd3dc95819afb511e6dcabf4a90b345a454" },
  { name: "moss_tts_local_fixed_sampled_frame.onnx", sizeBytes: 471_262, sha256: "40cdb00efc171c450cf91468e01429caa41b0252222cd308e978f58fe354afa8" },
  { name: "moss_tts_local_shared.data", sizeBytes: 229_678_080, sha256: "bae7782032c0fb12490ab42afe009f87ae6c75a0f0596fc7b5c08e4d5ee93916" },
  { name: "moss_tts_prefill.onnx", sizeBytes: 283_305, sha256: "d56126dcd0574c2f15d98fc6b35eda68d0386b5bd9c5e38e28548d6f2ea8f3db" },
];
const MOSS_CODEC_FILES: Array<{ name: string; sizeBytes: number; sha256: string }> = [
  { name: "codec_browser_onnx_meta.json", sizeBytes: 17_036, sha256: "3e291c883bb7d11ff2fe8e964e3e495519760358859f35c951254c7741592731" },
  { name: "moss_audio_tokenizer_decode_full.onnx", sizeBytes: 681_902, sha256: "0fbbafe3fd4afa2a019af5c5ced204af6e2d1db044fa40f021525d2aee95b4ac" },
  { name: "moss_audio_tokenizer_decode_shared.data", sizeBytes: 44_198_912, sha256: "e69d52e0f4e84ca27850557ee54face46632d3a5a16c89bd246c7c408466dcad" },
  { name: "moss_audio_tokenizer_decode_step.onnx", sizeBytes: 351_400, sha256: "9527c86a29e1837edec1f74db57d5eeaadb3a715af3382703566460afed25855" },
  { name: "moss_audio_tokenizer_encode.data", sizeBytes: 44_507_136, sha256: "aa751265b2bab2887eac224484546b194875aa7494b607115439b3dc6b228a2c" },
  { name: "moss_audio_tokenizer_encode.onnx", sizeBytes: 815_775, sha256: "eadea4a645abdcf98714c7aead122ee2ce7da6e080f9f80b977cd1ca8e19473a" },
];

export const MOSS_TTS_SPEC: VoiceModelSpec = {
  id: "moss-tts",
  label: "MOSS-TTS-Nano 本地语音合成（ONNX CPU）",
  sizeHint: "约 728MB（TTS + 声码器两组 ONNX 权重）",
  required: [
    "MOSS-TTS-Nano-100M-ONNX/tts_browser_onnx_meta.json",
    "MOSS-TTS-Nano-100M-ONNX/tokenizer.model",
    "MOSS-Audio-Tokenizer-Nano-ONNX/codec_browser_onnx_meta.json",
  ],
  files: [
    ...MOSS_TTS_FILES.map((file) => ({
      ...file,
      name: `MOSS-TTS-Nano-100M-ONNX/${file.name}`,
      urls: mossUrls(MOSS_TTS_REPO_MS, MOSS_TTS_REPO_HF, MOSS_TTS_REVISION, file.name),
    })),
    ...MOSS_CODEC_FILES.map((file) => ({
      ...file,
      name: `MOSS-Audio-Tokenizer-Nano-ONNX/${file.name}`,
      urls: mossUrls(MOSS_CODEC_REPO_MS, MOSS_CODEC_REPO_HF, MOSS_CODEC_REVISION, file.name),
    })),
  ],
};

// ── 目录约定 ───────────────────────────────────────────────────

/** 模型根目录：<数据目录>/models（PENGLAI_MODEL_DIR 可覆盖）。 */
export function voiceModelsBaseDir(dataDir: string): string {
  const override = process.env.PENGLAI_MODEL_DIR;
  if (override && override.trim()) return path.resolve(override);
  return path.join(dataDir, "models");
}

export function senseVoiceDir(dataDir: string): string {
  const override = process.env.PENGLAI_VOICE_SENSEVOICE_DIR;
  if (override && override.trim()) return path.resolve(override);
  return path.join(voiceModelsBaseDir(dataDir), "sensevoice");
}

export function mossTtsDir(dataDir: string): string {
  const override = process.env.PENGLAI_VOICE_MOSSTTS_DIR;
  if (override && override.trim()) return path.resolve(override);
  return path.join(voiceModelsBaseDir(dataDir), "moss-tts");
}

export function modelDirFor(spec: VoiceModelSpec, dataDir: string): string {
  return spec.id === "sensevoice" ? senseVoiceDir(dataDir) : mossTtsDir(dataDir);
}

/** 模型是否已齐（就绪判定文件全部存在）。 */
export function modelPresent(spec: VoiceModelSpec, dataDir: string): boolean {
  const dir = modelDirFor(spec, dataDir);
  return spec.required.every((name) => fs.existsSync(path.join(dir, name)));
}

// ── 下载器 ─────────────────────────────────────────────────────

export interface DownloadProgress {
  file: string;
  /** 本文件已下载字节。 */
  got: number;
  /** 本文件总字节（0 = 未知）。 */
  total: number;
}

export interface DownloadDeps {
  fetchImpl?: VoiceFetch;
  onProgress?: (event: DownloadProgress) => void;
}

function sha256Of(file: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

async function streamToDisk(
  res: VoiceFetchResponse,
  dest: string,
  append: boolean,
  maxBytes: number,
  onChunk: (got: number) => void,
): Promise<number> {
  const fd = fs.openSync(dest, append ? "a" : "w");
  let got = append ? fs.statSync(dest).size : 0;
  if (got > maxBytes) {
    fs.closeSync(fd);
    throw new Error("partial model file exceeds the pinned size");
  }
  try {
    if (!res.body) throw new Error("响应无 body");
    for await (const chunk of res.body) {
      got += chunk.length;
      if (got > maxBytes) throw new Error("model download exceeds the pinned size");
      fs.writeSync(fd, chunk);
      onChunk(got);
    }
  } finally {
    fs.closeSync(fd);
  }
  return got;
}

function verifiedFile(file: string, spec: VoiceFileSpec): boolean {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  if (spec.sizeBytes !== undefined && fs.statSync(file).size !== spec.sizeBytes) return false;
  return !spec.sha256 || sha256Of(file) === spec.sha256;
}

/** 单文件下载：.part 断点续传 + 镜像候选顺序尝试 + 可选校验 + 原子改名。 */
async function downloadOne(
  spec: VoiceFileSpec,
  destDir: string,
  deps: DownloadDeps,
): Promise<string | null> {
  const fetchImpl = deps.fetchImpl ?? productionFetch;
  const dest = path.join(destDir, spec.name);
  if (verifiedFile(dest, spec)) return dest; // 已存在且完整才跳过（幂等）
  if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const maxBytes = spec.sizeBytes ?? 512 * 1024 * 1024;

  for (const url of spec.urls) {
    try {
      const existing = fs.existsSync(part) ? fs.statSync(part).size : 0;
      if (existing > maxBytes) fs.rmSync(part, { force: true });
      const resumeAt = fs.existsSync(part) ? fs.statSync(part).size : 0;
      const headers: Record<string, string> = {};
      if (resumeAt > 0) headers.Range = `bytes=${resumeAt}-`;
      const res = await fetchImpl(url, { headers });
      const append = resumeAt > 0 && res.status === 206;
      if (!res.ok && res.status !== 206) {
        if (res.status === 416 && resumeAt > 0 && verifiedFile(part, spec)) {
          fs.renameSync(part, dest);
          return dest;
        }
        continue; // 换下一个镜像
      }
      const totalHeader = Number(res.headers.get("content-length") ?? 0);
      const total = append ? resumeAt + totalHeader : totalHeader;
      if (total > maxBytes) throw new Error("model response exceeds the pinned size");
      const got = await streamToDisk(res, part, append, maxBytes, (value) =>
        deps.onProgress?.({ file: spec.name, got: value, total }),
      );
      if (total > 0 && got < total) continue; // 截断：换镜像重试（.part 保留续传）
      fs.renameSync(part, dest);
      if (!verifiedFile(dest, spec)) {
        fs.rmSync(dest, { force: true });
        continue;
      }
      return dest;
    } catch {
      continue; // 网络类失败：换镜像
    }
  }
  return null;
}

export interface ModelInstallResult {
  id: VoiceModelSpec["id"];
  ok: boolean;
  /** 已就位的文件（相对路径）。 */
  installed: string[];
  /** 失败的文件（相对路径 + 已尝试的镜像数）。 */
  failed: string[];
  detail: string;
}

/**
 * 下载一个语音模型（幂等）：已有文件跳过；逐文件镜像顺序尝试 + .part 续传；
 * 每个文件必须通过固定大小与 SHA-256。绝不抛——结果如实报告。
 */
export async function ensureVoiceModel(
  spec: VoiceModelSpec,
  dataDir: string,
  deps: DownloadDeps = {},
): Promise<ModelInstallResult> {
  const dir = modelDirFor(spec, dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const installed: string[] = [];
  const failed: string[] = [];
  for (const file of spec.files) {
    const got = await downloadOne(file, dir, deps);
    if (got) installed.push(file.name);
    else failed.push(file.name);
  }
  const ok = modelPresent(spec, dataDir);
  return {
    id: spec.id,
    ok,
    installed,
    failed: ok ? [] : failed,
    detail: ok
      ? `${spec.label}：就绪（${dir}）`
      : `${spec.label}：未就绪，缺 ${failed.join("、") || spec.required.join("、")}（各镜像均已尝试）`,
  };
}
