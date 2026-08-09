/**
 * 身份诞生的 host 侧核心（无 IO）：起名 → 种子 SOP 过审入树 → 身份落 L1。
 *
 * 两个调用面：
 *   - CLI 向导：cli/identity-ceremony.ts（翻页 IO + prompter）；
 *   - 桌面首次启动向导：onboarding.status / onboarding.birthIdentity RPC。
 *
 * 幂等：L1 已有身份 → 直接返回（不重复仪式、不重复播种）；SOP 同名已在
 * 树中（如迁移工具先入）→ 保留既有版本，不覆盖。
 */

import type { MemoryStore } from "../memory.js";
import { auditCandidateSop } from "../distill/audit.js";
import { SEED_SOPS } from "./seed-sops.js";
import { sanitizeAssistantName } from "./intro.js";

/** 种子来自内置、逐条规则审计的版本，不伪造 Task/Run provenance。 */
const SEED_PROVENANCE = {
  sourceKind: "seed",
  sourceTaskId: null,
  sourceRunId: null,
  evidenceId: null,
  auditedBy: "rules+seed-ceremony",
} as const;

export interface SeedPlantOutcome {
  name: string;
  outcome: "planted" | "kept" | "rejected";
  reason?: string;
}

/** 种子包逐条过审计入树（幂等：同名在树 → kept）。 */
export async function plantSeedSops(memory: MemoryStore): Promise<SeedPlantOutcome[]> {
  const outcomes: SeedPlantOutcome[] = [];
  for (const seed of SEED_SOPS) {
    let existing = "";
    try {
      existing = memory.readSop(seed.name);
    } catch {
      /* 不在树中 */
    }
    if (existing) {
      outcomes.push({ name: seed.name, outcome: "kept", reason: "同名 SOP 已在技能树（保留既有版本）" });
      continue;
    }
    const audit = await auditCandidateSop(seed.content);
    if (!audit.pass) {
      // 不该发生（测试钉死种子过审）；发生时如实报告、绝不入树。
      outcomes.push({
        name: seed.name,
        outcome: "rejected",
        reason: `审计未过（${audit.findings.map((f) => f.ruleId).join("；")}），未入树`,
      });
      continue;
    }
    memory.writeGlobalSop(seed.name, seed.content, {
      ...SEED_PROVENANCE,
      sourceRef: `builtin:0.4.0/${seed.name}`,
    });
    outcomes.push({ name: seed.name, outcome: "planted" });
  }
  return outcomes;
}

export interface BirthResult {
  /** 仪式是否举行（false = 已有身份，幂等短路）。 */
  ran: boolean;
  /** ran=true 时的诞生结果。 */
  name?: string;
  bornAt?: string;
  seeds?: SeedPlantOutcome[];
  /** L1 托管区写入是否成功（false = L1 已满，如实报告，种子照常入树）。 */
  identityWritten?: boolean;
  /** ran=false 时的已有名字。 */
  existingName?: string;
}

/**
 * 举行诞生仪式（host 侧，无 IO）：名字卫生 → 种子 SOP 入树 → 身份落
 * L1 托管区。已有身份直接短路（二次运行不重复）。
 */
export async function runBirth(
  memory: MemoryStore,
  rawName: string,
  today: () => string = () => new Date().toISOString().slice(0, 10),
): Promise<BirthResult> {
  const existing = memory.readIdentity();
  if (existing) {
    return { ran: false, existingName: existing.name };
  }
  const name = sanitizeAssistantName(rawName);
  const bornAt = today();
  const seeds = await plantSeedSops(memory);
  const identityWritten = memory.writeIdentity({ name, bornAt });
  return { ran: true, name, bornAt, seeds, identityWritten };
}
