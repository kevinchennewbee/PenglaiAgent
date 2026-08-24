import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PenglaiError } from "@penglai/contracts";
import { PINNED_DSH } from "./index.js";

export const FILE_INTAKE_SPIKE_ID = "R56-FILE-016";
export const FILE_INTAKE_BLOCK_CODE = "DSH_NO_GENERIC_FILE_TURN_API" as const;
export const OFFICIAL_IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const OFFICIAL_CONVERSATION_INPUT_SLOTS = [
  "conversation.input.left",
  "conversation.input.right",
  "conversation.input.attachments",
  "conversation.input.dock",
  "conversation.input.overlay",
] as const;

export type FileIntakeSpikeVerdict = "GO" | "BLOCKED";

export interface FileIntakeSpikeReport {
  requirement: typeof FILE_INTAKE_SPIKE_ID;
  dsh: string;
  verdict: FileIntakeSpikeVerdict;
  blockCode?: typeof FILE_INTAKE_BLOCK_CODE;
  officialImageMediaTypes: readonly string[];
  contentBlockTypes: string[];
  promptPartTypes: string[];
  conversationInputSlots: string[];
  composerDraftFields: string[];
  genericFileApis: string[];
  notes: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const req = createRequire(import.meta.url);

function packageRoot(specifier: string, resolver = req): string {
  return dirname(resolver.resolve(`${specifier}/package.json`));
}

function readOfficial(specifier: string, relativePath: string, resolver = req): string {
  return readFileSync(join(packageRoot(specifier, resolver), relativePath), "utf8");
}

function captureGroup(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern);
  const value = match?.[1];
  if (!value) throw new PenglaiError("DSH_CONTRACT_DRIFT", `missing ${label}`);
  return value;
}

function quotedStrings(source: string): string[] {
  return [...source.matchAll(/'([^']+)'/g)].map((row) => row[1]).filter((value): value is string => Boolean(value));
}

/**
 * Inspect pinned DSH rc.2 attachment, prompt, and composer contracts.
 * This is an interface probe, not a product file composer.
 */
export function probeOfficialFileIntake(): FileIntakeSpikeReport {
  const llmReq = createRequire(req.resolve("@deepseek-ai/dsh-llm/package.json"));
  const dshReq = createRequire(req.resolve("@deepseek-ai/dsh/package.json"));
  const attachmentTypes = readOfficial("@deepseek-ai/dsh-attachment", "lib/types/types.d.ts", llmReq);
  const attachmentIndex = readOfficial("@deepseek-ai/dsh-attachment", "lib/types/index.d.ts", llmReq);
  const attachmentReadme = readOfficial("@deepseek-ai/dsh-attachment", "README.md", llmReq);
  const llmTypes = readOfficial("@deepseek-ai/dsh-llm", "lib/types/types.d.ts");
  const sessionApi = readOfficial("@deepseek-ai/dsh-host-apiproxy", "lib/types/api/sessions.d.ts", dshReq);
  const overlay = readFileSync(
    join(repoRoot, "overlays/dsh-0.1.1-rc.2/upstream/dsh-client-ui-conversation.client.js"),
    "utf8",
  );

  const imageMediaTypeUnion = captureGroup(
    attachmentTypes,
    /export type ImageMediaType = ([^;]+);/,
    "ImageMediaType",
  );
  const officialImageMediaTypes = quotedStrings(imageMediaTypeUnion);
  const contentBlockMap = captureGroup(llmTypes, /export interface ContentBlockMap \{([\s\S]*?)\n\}/, "ContentBlockMap");
  const contentBlockTypes = [...contentBlockMap.matchAll(/'([^']+)':/g)].map((row) => row[1]).filter((value): value is string => Boolean(value));
  const promptStart = sessionApi.indexOf("export type PromptContentPart =");
  const promptEnd = sessionApi.indexOf("export interface ModelSelection", promptStart);
  if (promptStart < 0 || promptEnd < 0) throw new PenglaiError("DSH_CONTRACT_DRIFT", "missing PromptContentPart");
  const promptUnion = sessionApi.slice(promptStart, promptEnd);
  const promptPartTypes = [...promptUnion.matchAll(/type: '([^']+)'/g)].map((row) => row[1]).filter((value): value is string => Boolean(value));
  const conversationInputSlots = OFFICIAL_CONVERSATION_INPUT_SLOTS.filter((slot) => overlay.includes(`"${slot}"`));
  const composerDraftFields = ["draft", "imageIds"].filter((field) => overlay.includes(field));
  const officialContracts = [attachmentTypes, attachmentIndex, llmTypes, sessionApi, overlay].join("\n");
  const genericFileApis = [
    "FileMediaType",
    "FileAttachmentRef",
    "EncodedFileAttachment",
    "createDraftFiles",
    "type: 'file'",
  ].filter((name) => officialContracts.includes(name));

  const imageOnly =
    officialImageMediaTypes.join(",") === OFFICIAL_IMAGE_MEDIA_TYPES.join(",") &&
    contentBlockTypes.includes("image") &&
    !contentBlockTypes.includes("file") &&
    promptPartTypes.join(",") === "text,image" &&
    genericFileApis.length === 0 &&
    overlay.includes("createDraftImages") &&
    overlay.includes('case "image/png"') &&
    overlay.includes("UnsupportedImageMediaTypeError") &&
    /Generic files, audio, video/i.test(attachmentReadme);

  if (!imageOnly) {
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "DSH attachment/prompt contract changed; re-review R56-FILE-016");
  }

  return {
    requirement: FILE_INTAKE_SPIKE_ID,
    dsh: PINNED_DSH,
    verdict: "BLOCKED",
    blockCode: FILE_INTAKE_BLOCK_CODE,
    officialImageMediaTypes,
    contentBlockTypes,
    promptPartTypes,
    conversationInputSlots,
    composerDraftFields,
    genericFileApis,
    notes: [
      "Official composer draft is text plus imageIds only.",
      "conversation.input.left/right/attachments/dock/overlay exist as UI slots.",
      "conversation.input.attachments is a single image-chip renderer, not a generic file rail.",
      "session.prompt / followup user content is text|image. No official file block or FileAttachmentRef.",
      "Do not bind ordinary files by DOM overlay, second chat, or invisible prompt text.",
    ],
  };
}

/** Fail closed until an official generic-file Turn API exists. */
export function refuseUnofficialFileTurnBinding(): never {
  throw new PenglaiError("DSH_CONTRACT_DRIFT", FILE_INTAKE_BLOCK_CODE);
}
