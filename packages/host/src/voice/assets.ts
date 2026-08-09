/**
 * 语音模型资产（按需下载，数据不出机）— 0.3.x 下载策略的 TS 移植。
 *
 * 继承的 0.3.x 真机教训（penglai_setup.py `_voice_install`，2026-06-12 踩坑）：
 *   1. **int8 单文件直下**：SenseVoice 只拉 model.int8.onnx（~229MB）+ tokens.txt
 *      （0.3MB），绝不拉含 895MB fp32 的整包——省近 4 倍流量；
 *   2. **镜像优先**：hf-mirror 在前、huggingface 在后（MOSS 另加 modelscope 最前）；
 *   3. **`.part` 断点续传**：半成品留在 .part，重跑时 Range 续传，成功才原子改名；
 *   4. **tar 兜底**：单文件全失败才整包下载（system tar 解压，取完即删 fp32 与 tar）；
 *   5. **只报告可证实状态**：每个文件下完即验（大小/sha256 可选），缺一报一。
 *
 * 模型根目录：`<数据目录>/models/`（默认 ~/.penglai/models/），可用
 * PENGLAI_MODEL_DIR / PENGLAI_VOICE_SENSEVOICE_DIR / PENGLAI_VOICE_MOSSTTS_DIR
 * 覆盖（与 0.3.x 及旧分支 tools/voice.ts 的约定一致）。
 *
 * 下载器全部走注入缝（VoiceFetch / spawn）：测试绝不真实下载大模型。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

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

export type VoiceSpawn = (
  cmd: string,
  args: string[],
) => { status: number | null; error?: Error };

const productionSpawn: VoiceSpawn = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "ignore" });
  return { status: r.status, ...(r.error ? { error: r.error } : {}) };
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
  /** tar 兜底：单文件全失败时整包下载解压（0.3.x 策略）。 */
  fallbackTar?: { urls: string[] };
}

const SENSEVOICE_REPO = "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17";
const SENSEVOICE_TAR = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2";

export const SENSEVOICE_SPEC: VoiceModelSpec = {
  id: "sensevoice",
  label: "SenseVoice 本地语音识别（含情绪标签）",
  sizeHint: "约 230MB（int8 推理件，不拉 895MB fp32 整包）",
  required: ["model.int8.onnx", "tokens.txt"],
  files: [
    {
      name: "model.int8.onnx",
      urls: [
        `https://hf-mirror.com/${SENSEVOICE_REPO}/resolve/main/model.int8.onnx`,
        `https://huggingface.co/${SENSEVOICE_REPO}/resolve/main/model.int8.onnx`,
      ],
    },
    {
      name: "tokens.txt",
      urls: [
        `https://hf-mirror.com/${SENSEVOICE_REPO}/resolve/main/tokens.txt`,
        `https://huggingface.co/${SENSEVOICE_REPO}/resolve/main/tokens.txt`,
      ],
    },
  ],
  fallbackTar: {
    urls: [
      `https://gh-proxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${SENSEVOICE_TAR}`,
      `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${SENSEVOICE_TAR}`,
    ],
  },
};

function mossUrls(repoModelscope: string, repoHf: string, file: string): string[] {
  return [
    `https://modelscope.cn/models/${repoModelscope}/resolve/master/${file}`,
    `https://hf-mirror.com/${repoHf}/resolve/main/${file}`,
    `https://huggingface.co/${repoHf}/resolve/main/${file}`,
  ];
}

const MOSS_TTS_REPO_MS = "openmoss/MOSS-TTS-Nano-100M-ONNX";
const MOSS_TTS_REPO_HF = "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX";
const MOSS_CODEC_REPO_MS = "openmoss/MOSS-Audio-Tokenizer-Nano-ONNX";
const MOSS_CODEC_REPO_HF = "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX";

/** MOSS-TTS-Nano 浏览器版 ONNX 清单（与 0.3.x tts_service.py 同源）。 */
const MOSS_TTS_FILES = [
  "browser_poc_manifest.json",
  "tts_browser_onnx_meta.json",
  "tokenizer.model",
  "moss_tts_decode_step.onnx",
  "moss_tts_global_shared.data",
  "moss_tts_local_cached_step.onnx",
  "moss_tts_local_decoder.onnx",
  "moss_tts_local_fixed_sampled_frame.onnx",
  "moss_tts_local_shared.data",
  "moss_tts_prefill.onnx",
];
const MOSS_CODEC_FILES = [
  "codec_browser_onnx_meta.json",
  "moss_audio_tokenizer_decode_full.onnx",
  "moss_audio_tokenizer_decode_shared.data",
  "moss_audio_tokenizer_decode_step.onnx",
  "moss_audio_tokenizer_encode.data",
  "moss_audio_tokenizer_encode.onnx",
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
    ...MOSS_TTS_FILES.map((name) => ({
      name: `MOSS-TTS-Nano-100M-ONNX/${name}`,
      urls: mossUrls(MOSS_TTS_REPO_MS, MOSS_TTS_REPO_HF, name),
    })),
    ...MOSS_CODEC_FILES.map((name) => ({
      name: `MOSS-Audio-Tokenizer-Nano-ONNX/${name}`,
      urls: mossUrls(MOSS_CODEC_REPO_MS, MOSS_CODEC_REPO_HF, name),
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
  spawnImpl?: VoiceSpawn;
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
  onChunk: (got: number) => void,
): Promise<number> {
  const fd = fs.openSync(dest, append ? "a" : "w");
  let got = append ? fs.statSync(dest).size : 0;
  try {
    if (!res.body) throw new Error("响应无 body");
    for await (const chunk of res.body) {
      fs.writeSync(fd, chunk);
      got += chunk.length;
      onChunk(got);
    }
  } finally {
    fs.closeSync(fd);
  }
  return got;
}

/** 单文件下载：.part 断点续传 + 镜像候选顺序尝试 + 可选校验 + 原子改名。 */
async function downloadOne(
  spec: VoiceFileSpec,
  destDir: string,
  deps: DownloadDeps,
): Promise<string | null> {
  const fetchImpl = deps.fetchImpl ?? productionFetch;
  const dest = path.join(destDir, spec.name);
  if (fs.existsSync(dest)) return dest; // 已存在跳过（幂等）
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;

  for (const url of spec.urls) {
    try {
      const existing = fs.existsSync(part) ? fs.statSync(part).size : 0;
      const headers: Record<string, string> = {};
      if (existing > 0) headers.Range = `bytes=${existing}-`;
      const res = await fetchImpl(url, { headers });
      const append = existing > 0 && res.status === 206;
      if (!res.ok && res.status !== 206) {
        if (res.status === 416 && existing > 0) {
          // 服务端认为已下完：直接收尾校验
          fs.renameSync(part, dest);
          return dest;
        }
        continue; // 换下一个镜像
      }
      const totalHeader = Number(res.headers.get("content-length") ?? 0);
      const total = append ? existing + totalHeader : totalHeader;
      const got = await streamToDisk(res, part, append, (value) =>
        deps.onProgress?.({ file: spec.name, got: value, total }),
      );
      if (total > 0 && got < total) continue; // 截断：换镜像重试（.part 保留续传）
      fs.renameSync(part, dest);
      if (spec.sha256 && sha256Of(dest) !== spec.sha256) {
        fs.rmSync(dest, { force: true });
        continue;
      }
      if (spec.sizeBytes && fs.statSync(dest).size !== spec.sizeBytes) {
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

/** tar 兜底（0.3.x 策略）：整包下载 → system tar 解压 → 删 fp32 与 tar。 */
async function downloadViaTar(
  spec: VoiceModelSpec,
  destDir: string,
  deps: DownloadDeps,
): Promise<boolean> {
  if (!spec.fallbackTar) return false;
  const fetchImpl = deps.fetchImpl ?? productionFetch;
  const spawnImpl = deps.spawnImpl ?? productionSpawn;
  const tarPath = path.join(os.tmpdir(), `penglai-voice-${process.pid}-${Date.now()}.tar.bz2`);
  try {
    let got = false;
    for (const url of spec.fallbackTar.urls) {
      try {
        const res = await fetchImpl(url, {});
        if (!res.ok) continue;
        await streamToDisk(res, tarPath, false, (value) =>
          deps.onProgress?.({ file: "(整包 tar 兜底)", got: value, total: 0 }),
        );
        got = true;
        break;
      } catch {
        continue;
      }
    }
    if (!got) return false;
    const r = spawnImpl("tar", ["-xjf", tarPath, "-C", destDir]);
    if (r.error || r.status !== 0) return false;
    // fp32 整包件不用（0.3.x：删 model.onnx 省 895MB）
    for (const name of ["model.onnx"]) {
      for (const candidate of [
        path.join(destDir, name),
        path.join(destDir, path.basename(destDir), name),
      ]) {
        try {
          fs.rmSync(candidate, { force: true });
        } catch {
          /* best-effort */
        }
      }
    }
    return spec.required.every((name) => fs.existsSync(path.join(destDir, name)));
  } finally {
    try {
      fs.rmSync(tarPath, { force: true });
    } catch {
      /* best-effort */
    }
  }
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
 * SenseVoice 单文件全失败时 tar 兜底。绝不抛——结果如实报告。
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
  // 单文件路径有失败且模型未齐 → tar 兜底（0.3.x：仅 SenseVoice 配了兜底）
  if (failed.length > 0 && !modelPresent(spec, dataDir) && spec.fallbackTar) {
    if (await downloadViaTar(spec, dir, deps)) {
      return {
        id: spec.id,
        ok: true,
        installed: spec.required,
        failed: [],
        detail: `${spec.label}：经整包 tar 兜底就绪`,
      };
    }
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
