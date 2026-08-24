import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { PINNED_DSH } from "./index.js";

export const MEMORY_CURATOR_SPIKE_ID = "R56-MEM-005";
export const MEMORY_CURATOR_PRESET_ID = "penglai-memory-curator";
export const MEMORY_CURATOR_NO_TOOLS_REASON = "penglai-memory-curator/no-tools";
export const CURATOR_MAX_CANDIDATES = 8;
export const CURATOR_TEXT_MAX = 2000;
export const CURATOR_RATIONALE_MAX = 500;

export const CURATOR_KINDS = ["preference", "project_fact", "decision", "constraint", "person_fact"] as const;
export const CURATOR_SENSITIVITIES = ["normal", "sensitive", "prohibited"] as const;
export const CURATOR_SCOPES = ["workspace", "personal"] as const;

export type CuratorKind = (typeof CURATOR_KINDS)[number];
export type CuratorSensitivity = (typeof CURATOR_SENSITIVITIES)[number];
export type CuratorSuggestedScope = (typeof CURATOR_SCOPES)[number];
export type MemoryCuratorSpikeVerdict = "GO" | "PARTIAL" | "BLOCKED";

export interface CuratorCandidateDraft {
  kind: CuratorKind;
  text: string;
  rationale: string;
  sensitivity: CuratorSensitivity;
  confidence: number;
  suggestedScope: CuratorSuggestedScope;
}

export interface CuratorParseOk {
  ok: true;
  candidates: CuratorCandidateDraft[];
}

export interface CuratorParseFail {
  ok: false;
  code: "CURATOR_JSON_INVALID" | "CURATOR_SCHEMA_INVALID";
}

export type CuratorParseResult = CuratorParseOk | CuratorParseFail;

export interface MemoryCuratorSpikeReport {
  requirement: typeof MEMORY_CURATOR_SPIKE_ID;
  dsh: string;
  verdict: MemoryCuratorSpikeVerdict;
  officialAgentCreate: boolean;
  officialAgentOptionsKeys: string[];
  generateOptionKeys: string[];
  providerJsonSchema: boolean;
  toolsDisabledBy: "tools.guard";
  hostJsonSchema: boolean;
  notes: string[];
}

const req = createRequire(import.meta.url);

function packageRoot(specifier: string): string {
  return dirname(req.resolve(`${specifier}/package.json`));
}

function readOfficial(specifier: string, relativePath: string): string {
  return readFileSync(join(packageRoot(specifier), relativePath), "utf8");
}

function captureGroup(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern);
  const value = match?.[1];
  if (!value) throw new PenglaiError("DSH_CONTRACT_DRIFT", `missing ${label}`);
  return value;
}

function interfaceKeys(source: string): string[] {
  return [...source.matchAll(/^\s+(?:readonly\s+)?([A-Za-z][A-Za-z0-9]*)\??:/gm)]
    .map((row) => row[1])
    .filter((value): value is string => Boolean(value));
}

const CURATOR_FIELDS = new Set(["kind", "text", "rationale", "sensitivity", "confidence", "suggestedScope"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function parseOneCandidate(value: unknown): CuratorCandidateDraft | undefined {
  const row = asRecord(value);
  if (!row) return undefined;
  const keys = Object.keys(row);
  if (keys.length !== CURATOR_FIELDS.size || keys.some((key) => !CURATOR_FIELDS.has(key))) return undefined;
  if (!CURATOR_KINDS.includes(row.kind as CuratorKind)) return undefined;
  if (!CURATOR_SENSITIVITIES.includes(row.sensitivity as CuratorSensitivity)) return undefined;
  if (!CURATOR_SCOPES.includes(row.suggestedScope as CuratorSuggestedScope)) return undefined;
  if (typeof row.text !== "string" || row.text.length < 1 || row.text.length > CURATOR_TEXT_MAX) return undefined;
  if (typeof row.rationale !== "string" || row.rationale.length < 1 || row.rationale.length > CURATOR_RATIONALE_MAX) {
    return undefined;
  }
  if (typeof row.confidence !== "number" || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) {
    return undefined;
  }
  return {
    kind: row.kind as CuratorKind,
    text: row.text,
    rationale: row.rationale,
    sensitivity: row.sensitivity as CuratorSensitivity,
    confidence: row.confidence,
    suggestedScope: row.suggestedScope as CuratorSuggestedScope,
  };
}

/** Host-side strict schema. Provider-native json_schema is not in GenerateOptions. */
export function parseCuratorOutput(raw: string): CuratorParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: "CURATOR_JSON_INVALID" };
  }
  const root = asRecord(parsed);
  if (!root || Object.keys(root).join(",") !== "candidates" || !Array.isArray(root.candidates)) {
    return { ok: false, code: "CURATOR_SCHEMA_INVALID" };
  }
  if (root.candidates.length > CURATOR_MAX_CANDIDATES) return { ok: false, code: "CURATOR_SCHEMA_INVALID" };
  const candidates: CuratorCandidateDraft[] = [];
  for (const item of root.candidates) {
    const row = parseOneCandidate(item);
    if (!row) return { ok: false, code: "CURATOR_SCHEMA_INVALID" };
    candidates.push(row);
  }
  return { ok: true, candidates };
}

/** Official tools.guard deny-all for model-initiated tool execution. */
export function denyAllModelTools(_execution: unknown): string {
  return MEMORY_CURATOR_NO_TOOLS_REASON;
}

export function failOpenCuratorParse(raw: string): CuratorParseOk | { ok: false; failOpen: true; code: CuratorParseFail["code"] } {
  const parsed = parseCuratorOutput(raw);
  if (parsed.ok) return parsed;
  return { ok: false, failOpen: true, code: parsed.code };
}

export function probeOfficialMemoryCurator(): MemoryCuratorSpikeReport {
  const agentOptions = captureGroup(
    readOfficial("@deepseek-ai/dsh-agent", "lib/types/runtime-types.d.ts"),
    /export interface AgentOptions \{([\s\S]*?)\n\}/,
    "AgentOptions",
  );
  const createAgent = readOfficial("@deepseek-ai/dsh-agent", "lib/types/index.d.ts");
  const generateOptions = captureGroup(
    readOfficial("@deepseek-ai/dsh-llm", "lib/types/types.d.ts"),
    /export interface GenerateOptions \{([\s\S]*?)\n\}/,
    "GenerateOptions",
  );
  const officialAgentOptionsKeys = interfaceKeys(agentOptions);
  const generateOptionKeys = interfaceKeys(generateOptions);
  const providerJsonSchema =
    /\bresponseFormat\b/.test(generateOptions) ||
    /\bjson_schema\b/.test(generateOptions) ||
    /\boutputSchema\b/.test(generateOptions);
  if (officialAgentOptionsKeys.join(",") !== "provider,model,maxTokens") {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "AgentOptions keys changed; re-review R56-MEM-005");
  }
  if (!createAgent.includes("create(options: CreateAgentOptions)") || !createAgent.includes("setup?: AgentSetup")) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "agents.create/setup missing");
  }
  if (providerJsonSchema) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "GenerateOptions gained structured output; upgrade curator spike");
  }
  if (!generateOptionKeys.includes("tools") || !generateOptionKeys.includes("maxTokens") || !generateOptionKeys.includes("purpose")) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "GenerateOptions contract changed");
  }

  return {
    requirement: MEMORY_CURATOR_SPIKE_ID,
    dsh: PINNED_DSH,
    verdict: "PARTIAL",
    officialAgentCreate: true,
    officialAgentOptionsKeys,
    generateOptionKeys,
    providerJsonSchema: false,
    toolsDisabledBy: "tools.guard",
    hostJsonSchema: true,
    notes: [
      "ctx.agents.create/resume with setup is the official dedicated Agent path.",
      "AgentOptions has provider/model/maxTokens only. tools:false is not an official field.",
      "tools.guard is the official deny-all for model tool execution, as used by Companion.",
      "GenerateOptions has no responseFormat/json_schema. Host parseCuratorOutput is the schema gate.",
      "Do not call another model SDK or endpoint. Fail Open on parse/provider errors.",
    ],
  };
}
