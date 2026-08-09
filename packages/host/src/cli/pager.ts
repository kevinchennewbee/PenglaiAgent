/**
 * 翻页渲染器 — 0.3.x penglai_setup.py 翻页式 UX 的 TS 移植。
 *
 *   · tty（且无 NO_COLOR）下每步清屏如新页面（ESC[2J ESC[H）+ 顶部迷你
 *     banner（一行身份感）；非 tty 自动降级为顺序步骤头，不挂起、不喷转义码。
 *   · 首页全 banner：水墨 ASCII logo + 朱砂印章 + 渐变波浪（256 色，
 *     非 paged 时全部纯文本）。
 *   · CJK 感知显示宽度（全角算 2 列），菜单对齐用。
 *
 * Pager 通过 WizardDeps 注入（测试可断言清屏序列与 banner 文案）。
 */

import type { CliIO } from "./format.js";

// ── CJK 感知宽度（0.3.x `_w` / `_pad` 的移植：全角算 2 列） ─────

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK Radicals / Kangxi / 表意文字符号
    (cp >= 0x3041 && cp <= 0x33ff) || // 平假名 … CJK 兼容
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 扩展 A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 统一表意文字
    (cp >= 0xa000 && cp <= 0xa4cf) || // 彝文
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul 音节
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容表意
    (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK 兼容形式
    (cp >= 0xff00 && cp <= 0xff60) || // 全角形式（含 ～）
    (cp >= 0xffe0 && cp <= 0xffe6) || // 全角符号
    (cp >= 0x1f000 && cp <= 0x1faff) || // emoji（🏮 等）
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK 扩展 B+
  );
}

/** 显示宽度：宽字符算 2 列，其余算 1 列。 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += isWideCodePoint(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

/** 按显示宽度右侧补空格对齐。 */
export function padDisplay(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

// ── 水墨 256 色调色板（0.3.x 原值） ─────────────────────────────

const ESC = "\u001b";
const FG = (n: number) => `38;5;${n}`;
const BG = (n: number) => `48;5;${n}`;
const INK = [152, 110, 67, 60, 59, 238]; // 水墨渐变：雾青 → 黛蓝 → 浓墨

const LOGO = [
  "██████╗ ███████╗███╗   ██╗ ██████╗ ██╗      █████╗ ██╗",
  "██╔══██╗██╔════╝████╗  ██║██╔════╝ ██║     ██╔══██╗██║",
  "██████╔╝█████╗  ██╔██╗ ██║██║  ███╗██║     ███████║██║",
  "██╔═══╝ ██╔══╝  ██║╚██╗██║██║   ██║██║     ██╔══██║██║",
  "██║     ███████╗██║ ╚████║╚██████╔╝███████╗██║  ██║██║",
  "╚═╝     ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝",
];

export interface Pager {
  /** true = 翻页模式（tty 且无 NO_COLOR）：清屏 + 彩色 + 迷你 banner。 */
  readonly paged: boolean;
  /** 新页面：paged 时清屏 + 迷你 banner；随后总是打印步骤头。 */
  page(stepNo: number | null, title: string): void;
  /** 首页全 banner（水墨 logo + 印章 + 波浪 + 身份行）。 */
  banner(): void;
  /** 步骤头（🏮 tag 标题 ─────）。 */
  header(tag: string, title: string): void;
  /** 迷你 banner（翻页页顶的一行身份感）。 */
  miniBanner(): void;
  /** 染色（paged 时 256 色，否则原文）。 */
  paint(text: string, ...codes: string[]): string;
}

export const WIZARD_TOTAL_STEPS = 4;

export function createPager(io: CliIO, options: { noColor?: boolean } = {}): Pager {
  const noColor = options.noColor ?? process.env.NO_COLOR !== undefined;
  const paged = io.tty && !noColor && process.env.TERM !== "dumb";

  const paint = (text: string, ...codes: string[]): string => {
    if (!paged || codes.length === 0) return text;
    return `${ESC}[${codes.join(";")}m${text}${ESC}[0m`;
  };

  const wave = (n: number) =>
    paint("～".repeat(n), FG(37)) + paint("～".repeat(n), FG(30)) + paint("～".repeat(n), FG(23));

  const miniBanner = (): void => {
    io.line("");
    io.line(
      "  " +
        paint(" 蓬 萊 ", BG(124), FG(231), "1") +
        " " +
        paint("Penglai", "1", FG(252)) +
        paint(" · ", FG(238)) +
        paint("个人 AI 管家", FG(245)),
    );
    io.line("  " + wave(7));
  };

  const header = (tag: string, title: string): void => {
    const rule = "─".repeat(Math.max(4, 50 - displayWidth(tag) - displayWidth(title)));
    io.line("");
    io.line(`🏮 ${paint(tag, "1", FG(167))} ${paint(title, "1", FG(153))} ${paint(rule, FG(238))}`);
  };

  return {
    paged,
    paint,
    miniBanner,
    header,
    page(stepNo, title) {
      if (paged) {
        io.out(`${ESC}[2J${ESC}[H`);
        miniBanner();
      }
      const tag = stepNo === null ? "可选" : `步骤 ${stepNo}/${WIZARD_TOTAL_STEPS}`;
      header(tag, title);
    },
    banner() {
      const seal: Record<number, string> = { 1: " 蓬 ", 2: " 萊 " };
      io.line("");
      LOGO.forEach((line, i) => {
        const tail = seal[i] ? "   " + paint(seal[i], BG(124), FG(231), "1") : "";
        io.line("  " + paint(line, FG(INK[i])) + tail);
      });
      io.line("  " + wave(9));
      io.line(
        "   " +
          paint("蓬 莱 · 个人 AI 助理 0.4.0", "1", FG(252)) +
          paint("（Pi 内核 · TypeScript）", FG(245)),
      );
      io.line(
        "   " +
          paint("飞书 · 全工具 · 记忆 · 进化", FG(245)) +
          paint("  ──  ", FG(238)) +
          paint("八仙过海，各显神通", FG(245)),
      );
    },
  };
}
