import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { PINNED_DSH } from "./index.js";

export const MEMORY_CURATOR_SPIKE_ID = "R56-MEM-005";
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
  officialLlmStream: boolean;
  officialCreateUserMessage: boolean;
  generateOptionKeys: string[];
  providerJsonSchema: boolean;
  purposeSupportsCurator: boolean;
  createsAgent: false;
  createsSession: false;
  toolsDisabledBy: "empty-tools-list";
  alphaJobsDecision: "REJECT_USER_VISIBLE";
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

export function failOpenCuratorParse(raw: string): CuratorParseOk | { ok: false; failOpen: true; code: CuratorParseFail["code"] } {
  const parsed = parseCuratorOutput(raw);
  if (parsed.ok) return parsed;
  return { ok: false, failOpen: true, code: parsed.code };
}

export function probeOfficialMemoryCurator(): MemoryCuratorSpikeReport {
  const llmRuntime = readOfficial("@deepseek-ai/dsh-llm", "lib/types/index.d.ts");
  const messages = readOfficial("@deepseek-ai/dsh-llm", "lib/types/message.d.ts");
  const generateOptions = captureGroup(
    readOfficial("@deepseek-ai/dsh-llm", "lib/types/types.d.ts"),
    /export interface GenerateOptions \{([\s\S]*?)\n\}/,
    "GenerateOptions",
  );
  const generateOptionKeys = interfaceKeys(generateOptions);
  const providerJsonSchema =
    /\bresponseFormat\b/.test(generateOptions) ||
    /\bjson_schema\b/.test(generateOptions) ||
    /\boutputSchema\b/.test(generateOptions);
  if (!llmRuntime.includes("stream(options: GenerateOptions): AsyncIterable<StreamChunk>")) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "official LLM stream missing");
  }
  if (!messages.includes("function createUserMessage")) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "official user-message factory missing");
  }
  if (providerJsonSchema) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "GenerateOptions gained structured output; upgrade curator spike");
  }
  if (!generateOptionKeys.includes("messages") || !generateOptionKeys.includes("tools") || !generateOptionKeys.includes("signal") || !generateOptionKeys.includes("maxTokens")) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "GenerateOptions contract changed");
  }

  return {
    requirement: MEMORY_CURATOR_SPIKE_ID,
    dsh: PINNED_DSH,
    verdict: "GO",
    officialLlmStream: true,
    officialCreateUserMessage: true,
    generateOptionKeys,
    providerJsonSchema: false,
    purposeSupportsCurator: /purpose\?:\s*['"][^\n]*memory/.test(generateOptions),
    createsAgent: false,
    createsSession: false,
    toolsDisabledBy: "empty-tools-list",
    alphaJobsDecision: "REJECT_USER_VISIBLE",
    hostJsonSchema: true,
    notes: [
      "Use one hand-built ctx.llm.stream request; do not create an Agent or Session.",
      "Pass an empty tools list and a bounded AbortSignal; no model tool can execute.",
      "GenerateOptions has no responseFormat/json_schema. Host parseCuratorOutput is the schema gate.",
      "The alpha.2 Jobs service is owner-visible background work and is not an internal Memory queue.",
      "Do not call another model SDK or endpoint. Fail Open on parse/provider errors.",
    ],
  };
}
