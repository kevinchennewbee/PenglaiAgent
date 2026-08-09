/**
 * penglai CLI — 统一会话语音层（数据不出机）。
 *
 * 职责边界：
 *   - 麦克风/扬声器是 CLI 侧外设（薄客户端的 I/O 末端）；ASR/TTS 引擎在
 *     host（voice.* RPC，原生依赖懒加载，doctor 报可用性）；
 *   - 录音 = ffmpeg（macOS avfoundation / Linux alsa），Enter 提前结束或
 *     到时自动停；播放 = afplay / aplay / ffplay 顺序候选；
 *   - 无模型/无麦克风/无 ffmpeg 一律优雅降级为纯文本 + 启用指引。
 *
 * 生产实现全部在注入缝后面（VoiceReplDeps）：测试用假录音/假播放/假引擎，
 * 绝不真实下载大模型、绝不真实开麦克风。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { CliError, type HostClient } from "./client.js";
import type { CommandContext } from "./commands.js";
import { flagValue, type ParsedArgs } from "./format.js";
import { openRegularFileNoFollow } from "../security/private-file.js";

// ── RPC 形状（与 host voice/service.ts 对齐） ──────────────────

export interface VoiceCapabilityRow {
  name: "asr" | "tts";
  status: "ready" | "partial" | "disabled";
  ready: boolean;
  missing: string[];
  modelDir: string;
  detail: string;
}

export interface VoiceStatusResult {
  asr: VoiceCapabilityRow;
  tts: VoiceCapabilityRow;
}

export interface TranscribeRpcResult {
  ok: boolean;
  text?: string;
  emotion?: string;
  language?: string;
  noSpeech?: boolean;
  error?: string;
}

export interface SynthesizeRpcResult {
  ok: boolean;
  wavBase64?: string;
  sampleRate?: number;
  error?: string;
}

export interface InstallRpcResult {
  results: Array<{ id: string; ok: boolean; detail: string; failed: string[] }>;
}

// ── REPL 语音缝 ────────────────────────────────────────────────

export interface VoiceRecording {
  wavBase64: string;
  format: string;
}

export interface VoiceReplDeps {
  /** 能力探测（生产 = voice.status RPC）。 */
  status: () => Promise<VoiceStatusResult>;
  /** 本地转写（生产 = voice.transcribe RPC）。 */
  transcribe: (wavBase64: string, format: string) => Promise<TranscribeRpcResult>;
  /** 本地合成（生产 = voice.synthesize RPC）。 */
  synthesize: (text: string) => Promise<SynthesizeRpcResult>;
  /** 录音（生产 = ffmpeg；测试 = 假录音）。null = 取消/不可用。 */
  record: () => Promise<VoiceRecording | null>;
  /** 播放（生产 = afplay/aplay；测试 = 记录调用）。 */
  play: (wavBase64: string) => Promise<void>;
}

/** 情绪标签注入上下文（design §7：SenseVoice 含情绪）——模型可见的固定格式。 */
export function formatVoicePrompt(text: string, emotion?: string, language?: string): string {
  const parts = [`情绪:${emotion ?? "NEUTRAL"}`];
  if (language && language !== "auto") parts.push(`语言:${language}`);
  return `[语音·${parts.join("·")}] ${text}`;
}

// ── 生产录音/播放（外设；注入缝默认实现） ──────────────────────

const DEFAULT_MAX_SECONDS = 15;

/** ffmpeg 录音入口参数（按平台）。 */
function ffmpegAudioInput(): string[] {
  return process.platform === "darwin"
    ? ["-f", "avfoundation", "-i", ":0"]
    : ["-f", "alsa", "-i", "default"];
}

/**
 * 生产录音：ffmpeg → 16kHz 单声道 wav；Enter 提前结束，到时自动停。
 * 无 ffmpeg / 无麦克风 → null（调用方降级为纯文本提示）。
 */
export function recordWithFFmpeg(opts: { maxSeconds?: number; onTick?: (line: string) => void } = {}): Promise<VoiceRecording | null> {
  const maxSeconds = Math.max(
    1,
    opts.maxSeconds ?? (Number(process.env.PENGLAI_VOICE_MAX_SECONDS ?? DEFAULT_MAX_SECONDS) || DEFAULT_MAX_SECONDS),
  );
  const tmp = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "penglai-voice-rec-")),
    `rec-${Date.now()}.wav`,
  );
  return new Promise<VoiceRecording | null>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        "ffmpeg",
        [
          "-y",
          "-loglevel", "error",
          ...ffmpegAudioInput(),
          "-t", String(maxSeconds),
          "-ar", "16000",
          "-ac", "1",
          "-sample_fmt", "s16",
          "-f", "wav",
          tmp,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
    } catch {
      resolve(null);
      return;
    }
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      process.stdin.removeListener("data", onKey);
      try {
        const opened = openRegularFileNoFollow(tmp);
        let wavBase64: string;
        try {
          if (opened.stat.size <= 44) throw new Error("recorded WAV is empty");
          wavBase64 = fs.readFileSync(opened.descriptor).toString("base64");
        } finally {
          fs.closeSync(opened.descriptor);
        }
        fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
        resolve(ok ? { wavBase64, format: "wav" } : null);
        return;
      } catch {
        /* fall through */
      }
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
      if (!ok && stderr.trim()) opts.onTick?.(`录音失败：${stderr.trim().split("\n").pop()}`);
      resolve(null);
    };
    const onKey = (): void => {
      // Enter/任意键提前结束：SIGINT 让 ffmpeg 正常收尾 wav 头
      try {
        child.kill("SIGINT");
      } catch {
        /* already gone */
      }
    };
    child.on("error", () => finish(false)); // ENOENT = 无 ffmpeg
    child.on("close", (code) => finish(code === 0));
    if (process.stdin.isTTY) {
      process.stdin.on("data", onKey);
    }
  }).finally(() => {
    if (process.stdin.isTTY) process.stdin.removeAllListeners("data");
  });
}

/** 生产播放：afplay（macOS）→ aplay（Linux）→ ffplay 候选；找不到则报告。 */
export async function playWithSystem(wavBase64: string): Promise<boolean> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-voice-play-"));
  const wav = path.join(dir, `play-${Date.now()}.wav`);
  fs.writeFileSync(wav, Buffer.from(wavBase64, "base64"));
  const candidates: Array<[string, string[]]> =
    process.platform === "darwin"
      ? [["afplay", [wav]]]
      : [
          ["aplay", [wav]],
          ["ffplay", ["-nodisp", "-autoexit", wav]],
        ];
  try {
    for (const [cmd, args] of candidates) {
      const found = spawnSync("which", [cmd], { stdio: "ignore" });
      if (found.error || found.status !== 0) continue;
      const played = spawnSync(cmd, args, { stdio: "ignore", timeout: 120_000 });
      return !played.error && played.status === 0;
    }
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 生产 REPL 语音缝：RPC 引擎 + 本机外设。 */
export function productionVoiceDeps(client: HostClient): VoiceReplDeps {
  return {
    status: () => client.rpc("voice.status", {}) as Promise<VoiceStatusResult>,
    transcribe: (wavBase64, format) =>
      client.rpc("voice.transcribe", { audioBase64: wavBase64, format }) as Promise<TranscribeRpcResult>,
    synthesize: (text) => client.rpc("voice.synthesize", { text }) as Promise<SynthesizeRpcResult>,
    record: () => recordWithFFmpeg(),
    play: async (wavBase64) => {
      await playWithSystem(wavBase64);
    },
  };
}

// ── penglai voice 命令面板 ─────────────────────────────────────

/**
 * `penglai voice` — 语音能力面板（组件级探测：引擎/模型/ffmpeg）。
 * `penglai voice setup [--tts|--all]` — 按需下载模型（进度实时渲染）。
 */
export async function cmdVoice(ctx: CommandContext, args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0] ?? "status";
  const { io, style } = ctx;

  if (sub === "status") {
    const status = (await ctx.client.rpc("voice.status", {})) as VoiceStatusResult;
    io.line(style.bold("voice（统一会话的本地语音，数据不出机）"));
    for (const cap of [status.asr, status.tts]) {
      const icon = cap.ready ? style.green("✓") : cap.status === "partial" ? style.yellow("!") : style.dim("○");
      io.line(`  ${icon} ${cap.detail}`);
      if (!cap.ready && cap.modelDir) io.line(style.dim(`     模型目录：${cap.modelDir}`));
    }
    if (!status.asr.ready || !status.tts.ready) {
      io.line(
        style.dim(
          "  启用：penglai voice setup（ASR 约 230MB）· penglai voice setup --tts（TTS 约 728MB）· 聊天内 /voice 或 penglai chat --voice",
        ),
      );
    } else {
      io.line(style.dim("  使用：penglai chat --voice，或聊天内 /voice 开关"));
    }
    return 0;
  }

  if (sub === "setup") {
    const which = args.flags.tts === true ? "tts" : flagValue(args.flags, "all") !== undefined || args.flags.all === true ? "all" : "asr";
    io.line(style.dim(`开始下载语音模型（${which}；镜像优先，断点可续传）…`));
    // 订阅下载进度（voice 频道）：单行刷新，非 tty 只打完成行。
    const progressLines = new Map<string, string>();
    const unsubscribe = await ctx.client.subscribe("voice", (event) => {
      if (event.event !== "voice.download.progress") return;
      const file = String(event.file ?? "");
      const got = Number(event.got ?? 0);
      const total = Number(event.total ?? 0);
      const line = total > 0 ? `${file}  ${Math.floor(got / 2 ** 20)}MB / ${Math.floor(total / 2 ** 20)}MB` : `${file}  ${Math.floor(got / 2 ** 20)}MB`;
      progressLines.set(file, line);
      if (io.tty) io.out(`\r  ${line}          \r`);
    });
    let result: InstallRpcResult;
    try {
      result = (await ctx.client.rpc("voice.install", { which })) as InstallRpcResult;
    } finally {
      unsubscribe();
      if (io.tty) io.out("\n");
    }
    let failed = 0;
    for (const row of result.results) {
      if (row.ok) io.line(`  ${style.green("✓")} ${row.detail}`);
      else {
        failed += 1;
        io.line(`  ${style.red("✗")} ${row.detail}`);
      }
    }
    if (failed === 0) {
      io.line(style.dim("下一步：penglai chat --voice 或聊天内 /voice 开聊。"));
    }
    return failed === 0 ? 0 : 1;
  }

  throw new CliError(`unknown voice subcommand: ${sub} (status|setup)`);
}
