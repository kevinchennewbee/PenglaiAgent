/**
 * 冷启动身份引导（M3′：贾维斯第一天是陌生人 → 身份诞生）。
 *
 * 首次运行向导完成后的「身份诞生」环节（可跳过、非 tty 降级、二次运行
 * 不重复）：
 *
 *   1. 给助理起名（默认「蓬莱」）；
 *   2. 一两句轻仪式感的首次对话——它自我介绍单一核心、本地陪伴、记忆进化
 *      （≤5 行）；
 *   3. 种子 SOP 包（0.3 纪律类精选，见 seed-sops.ts）逐条过蒸馏环审计
 *      规则器，过审入全局 SOP 区——冷启动即有一小套工作纪律；
 *   4. 身份（名字 + 诞生日）落全局记忆 L1 托管区；此后统一核心的系统
 *      提示词首行即带身份（buildSystemPrompt 读 readIdentity）。
 *
 * 幂等：L1 已有身份 → 直接返回（不重复仪式、不重复播种）；SOP 同名已在
 * 树中（如迁移工具先入）→ 保留既有版本，不覆盖。
 *
 * 文案/名字卫生在 onboarding/intro.ts，host 侧核心（种子入树 + 落 L1）
 * 在 onboarding/birth.ts——桌面首次启动向导经 onboarding.* RPC 复用同一
 * 核心；本文件只保留 CLI 翻页 IO，并 re-export 保持既有 import 不变。
 */

import type { CliIO } from "./format.js";
import type { WizardPrompter } from "./setup-wizard.js";
import type { MemoryStore } from "../memory.js";
import { DEFAULT_ASSISTANT_NAME, introLines, sanitizeAssistantName } from "../onboarding/intro.js";
import { plantSeedSops, type SeedPlantOutcome } from "../onboarding/birth.js";

export { introLines, sanitizeAssistantName } from "../onboarding/intro.js";
export { plantSeedSops, type SeedPlantOutcome } from "../onboarding/birth.js";

export interface CeremonyDeps {
  io: CliIO;
  /** null = 非交互环境（降级一行说明，绝不挂起）。 */
  prompter: WizardPrompter | null;
  memory: MemoryStore;
  /** 今天（YYYY-MM-DD），测试注入确定性时钟。 */
  today?: () => string;
}

export interface CeremonyResult {
  /** 仪式是否举行（false = 已有身份/降级/owner 跳过）。 */
  ran: boolean;
  name?: string;
  bornAt?: string;
  seeds?: SeedPlantOutcome[];
  /** 已有身份时的已有名字。 */
  existingName?: string;
  skipped?: boolean;
}

export async function runIdentityCeremony(deps: CeremonyDeps): Promise<CeremonyResult> {
  const { io, prompter, memory } = deps;
  const today = deps.today ?? (() => new Date().toISOString().slice(0, 10));

  // 二次运行不重复仪式。
  const existing = memory.readIdentity();
  if (existing) {
    return { ran: false, existingName: existing.name };
  }

  // 非 tty 降级：不举行、不播种，一行指引，绝不挂起。
  if (!prompter) {
    io.line(
      `  （非交互环境：跳过身份诞生环节；在终端运行 \`penglai setup\` 完成向导后可举行——可跳过）`,
    );
    return { ran: false };
  }

  io.line("");
  io.line("  ── 身份诞生 ────────────────────────");
  io.line("  大脑接上了。它还没有名字，也没有第一套工作纪律。");
  const answer = (
    await prompter.ask("  › 要为它举行诞生仪式吗（起名 + 自我介绍 + 种子 SOP 入树）？[Y/n]: ")
  ).trim().toLowerCase();
  if (answer === "n" || answer === "no") {
    io.line("  好，仪式改天再办——下次 `penglai setup` 完成向导后会再问。");
    return { ran: false, skipped: true };
  }

  const nameAnswer = await prompter.ask(`  › 给它起个名字（回车=${DEFAULT_ASSISTANT_NAME}）: `);
  const name = sanitizeAssistantName(nameAnswer);
  const bornAt = today();

  io.line("");
  for (const line of introLines(name)) io.line(`  ${line}`);
  io.line("");

  const seeds = await plantSeedSops(memory);
  const identityWritten = memory.writeIdentity({ name, bornAt });

  for (const seed of seeds) {
    if (seed.outcome === "planted") io.line(`  ✓ 工作纪律「${seed.name}」过审入树`);
    else if (seed.outcome === "kept") io.line(`  ○ 工作纪律「${seed.name}」${seed.reason}`);
    else io.line(`  ! 工作纪律「${seed.name}」${seed.reason}`);
  }
  if (identityWritten) {
    io.line(`  身份已落全局记忆 L1（${name} · 诞生日 ${bornAt}），今后对话我都带着它。`);
  } else {
    io.line("  ⚠ L1 已满（≤30 行铁律），身份未能写入——请手工精简 L1.md 后重试。");
  }
  io.line("  （`penglai memory sop list` 可随时查看技能树）");
  return { ran: true, name, bornAt, seeds };
}
