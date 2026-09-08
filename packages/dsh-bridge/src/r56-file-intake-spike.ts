import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import { PINNED_DSH } from "./index.js";

export const FILE_INTAKE_SPIKE_ID = "R56-FILE-016";
/** Unofficial DOM/second-chat/invisible-prompt binding remains forbidden. */
export const FILE_INTAKE_UNOFFICIAL_CODE = "UNOFFICIAL_FILE_TURN_BINDING" as const;
/** Penglai ArtifactService has not wired official uploadFile receipts yet. */
export const FILE_INTAKE_UNWIRED_CODE = "PENGLAI_COMPOSER_FILE_RECEIPT_UNWIRED" as const;
/** @deprecated Use FILE_INTAKE_UNOFFICIAL_CODE. Official alpha.2 has a file Turn API. */
export const FILE_INTAKE_BLOCK_CODE = FILE_INTAKE_UNOFFICIAL_CODE;
export const OFFICIAL_IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export const OFFICIAL_PROMPT_PART_TYPES = ["text", "image", "file"] as const;
export const OFFICIAL_COMPOSER_DRAFT_FIELDS = ["draft", "attachmentIds"] as const;
export const OFFICIAL_FILE_RECEIPT_FIELD = "receiptId" as const;
export const OFFICIAL_FILE_UPLOAD_PATH = "/api/session/uploadFileBinary" as const;
export const OFFICIAL_CONVERSATION_INPUT_SLOTS = [
  "conversation.input.left",
  "conversation.input.right",
  "conversation.input.attachments",
  "conversation.input.dock",
  "conversation.input.overlay",
] as const;
export const OFFICIAL_FILE_APIS = [
  "FileAttachmentRef",
  "EncodedFileAttachment",
  "type: 'file'",
] as const;

export type FileIntakeSpikeVerdict = "GO" | "BLOCKED";

export interface FileIntakeSpikeReport {
  requirement: typeof FILE_INTAKE_SPIKE_ID;
  dsh: string;
  verdict: FileIntakeSpikeVerdict;
  blockCode?: typeof FILE_INTAKE_UNOFFICIAL_CODE | typeof FILE_INTAKE_UNWIRED_CODE;
  officialImageMediaTypes: readonly string[];
  contentBlockTypes: string[];
  promptPartTypes: string[];
  conversationInputSlots: string[];
  composerDraftFields: string[];
  genericFileApis: string[];
  fileReceiptField?: typeof OFFICIAL_FILE_RECEIPT_FIELD;
  fileUploadPath?: typeof OFFICIAL_FILE_UPLOAD_PATH;
  notes: string[];
}

const req = createRequire(import.meta.url);

function packageRoot(specifier: string, resolver = req): string {
  return dirname(resolver.resolve(`${specifier}/package.json`));
}

function readOfficial(
  specifier: string,
  relativePath: string,
  resolver = req,
): string {
  return readFileSync(
    join(packageRoot(specifier, resolver), relativePath),
    "utf8",
  );
}

function captureGroup(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern);
  const value = match?.[1];
  if (!value) throw new PenglaiError("DSH_CONTRACT_DRIFT", `missing ${label}`);
  return value;
}

function quotedStrings(source: string): string[] {
  return [...source.matchAll(/'([^']+)'/g)]
    .map((row) => row[1])
    .filter((value): value is string => Boolean(value));
}

/**
 * Inspect pinned DSH alpha.2 attachment, prompt, and composer contracts.
 * This is an interface probe, not a product file composer.
 */
export function probeOfficialFileIntake(): FileIntakeSpikeReport {
  const llmReq = createRequire(
    req.resolve("@deepseek-ai/dsh-llm/package.json"),
  );
  const attachmentTypes = readOfficial(
    "@deepseek-ai/dsh-attachment",
    "lib/types/types.d.ts",
    llmReq,
  );
  const attachmentIndex = readOfficial(
    "@deepseek-ai/dsh-attachment",
    "lib/types/index.d.ts",
    llmReq,
  );
  const attachmentReadme = readOfficial(
    "@deepseek-ai/dsh-attachment",
    "README.md",
    llmReq,
  );
  const llmTypes = readOfficial("@deepseek-ai/dsh-llm", "lib/types/types.d.ts");
  const sessionApi = readOfficial(
    "@deepseek-ai/dsh-api-session-controller",
    "lib/types/types.d.ts",
  );
  const conversationClient = readOfficial(
    "@deepseek-ai/dsh-client-ui-conversation",
    "lib/client.js",
  );
  const conversationReq = createRequire(
    req.resolve("@deepseek-ai/dsh-client-ui-conversation/package.json"),
  );
  const fileUploadProtocol = readOfficial(
    "@deepseek-ai/dsh-client-file-upload",
    "lib/types/protocol.d.ts",
    conversationReq,
  );
  const fileUploadTypes = readOfficial(
    "@deepseek-ai/dsh-client-file-upload",
    "lib/types/types.d.ts",
    conversationReq,
  );

  const imageMediaTypeUnion = captureGroup(
    attachmentTypes,
    /export type ImageMediaType = ([^;]+);/,
    "ImageMediaType",
  );
  const officialImageMediaTypes = quotedStrings(imageMediaTypeUnion);
  const contentBlockMap = captureGroup(
    llmTypes,
    /export interface ContentBlockMap \{([\s\S]*?)\n\}/,
    "ContentBlockMap",
  );
  const contentBlockTypes = [...contentBlockMap.matchAll(/'([^']+)':/g)]
    .map((row) => row[1])
    .filter((value): value is string => Boolean(value));
  const promptStart = sessionApi.indexOf("export type PromptContentPart =");
  const promptEnd = sessionApi.indexOf(
    "export interface ModelSelection",
    promptStart,
  );
  if (promptStart < 0 || promptEnd < 0)
    throw new PenglaiError("DSH_CONTRACT_DRIFT", "missing PromptContentPart");
  const promptUnion = sessionApi.slice(promptStart, promptEnd);
  const promptPartTypes = [...promptUnion.matchAll(/type: '([^']+)'/g)]
    .map((row) => row[1])
    .filter((value): value is string => Boolean(value));
  const conversationInputSlots = OFFICIAL_CONVERSATION_INPUT_SLOTS.filter(
    (slot) => conversationClient.includes(`"${slot}"`),
  );
  const composerDraftFields = [...OFFICIAL_COMPOSER_DRAFT_FIELDS].filter(
    (field) => conversationClient.includes(field),
  );
  const officialContracts = [
    attachmentTypes,
    attachmentIndex,
    llmTypes,
    sessionApi,
    conversationClient,
    fileUploadProtocol,
    fileUploadTypes,
  ].join("\n");
  const genericFileApis = [...OFFICIAL_FILE_APIS].filter((name) =>
    officialContracts.includes(name),
  );
  const filePartHasReceipt =
    /type:\s*'file'[\s\S]*?receiptId:\s*Branded<'file-upload-receipt-id'>/.test(
      promptUnion,
    );
  const fileBlockProjectsHandleText = llmTypes.includes(
    "deterministic handle text (name, byte size, and the read-only saved path)",
  );
  const readmeGenericFiles =
    /attach images and generic files to prompts/i.test(attachmentReadme) &&
    /non-image file attaches to a prompt as a generic file/i.test(
      attachmentReadme,
    );
  const failed: string[] = [];
  if (
    officialImageMediaTypes.join(",") !== OFFICIAL_IMAGE_MEDIA_TYPES.join(",")
  ) {
    failed.push(
      `ImageMediaType=${officialImageMediaTypes.join(",") || "<missing>"}`,
    );
  }
  if (!contentBlockTypes.includes("image")) failed.push("missing ContentBlock image");
  if (!contentBlockTypes.includes("file")) failed.push("missing ContentBlock file");
  if (promptPartTypes.join(",") !== OFFICIAL_PROMPT_PART_TYPES.join(",")) {
    failed.push(`PromptContentPart=${promptPartTypes.join(",") || "<missing>"}`);
  }
  if (!filePartHasReceipt) failed.push("file PromptContentPart missing receiptId");
  if (genericFileApis.join(",") !== OFFICIAL_FILE_APIS.join(",")) {
    failed.push(`genericFileApis=${genericFileApis.join(",") || "<none>"}`);
  }
  if (officialContracts.includes("FileMediaType")) {
    failed.push("unexpected FileMediaType (files are untyped verbatim)");
  }
  if (conversationClient.includes("createDraftImages")) {
    failed.push("legacy createDraftImages still present");
  }
  if (!conversationClient.includes("createDrafts")) {
    failed.push("missing createDrafts");
  }
  if (!conversationClient.includes("attachmentIds")) {
    failed.push("missing composer attachmentIds");
  }
  if (composerDraftFields.join(",") !== OFFICIAL_COMPOSER_DRAFT_FIELDS.join(",")) {
    failed.push(`composerDraftFields=${composerDraftFields.join(",") || "<none>"}`);
  }
  if (
    !conversationClient.includes('case "image/png"') ||
    !conversationClient.includes("UnsupportedImageMediaTypeError")
  ) {
    failed.push("image MIME admission missing");
  }
  if (!conversationClient.includes("kind === \"file\"")) {
    failed.push("composer file drafts missing");
  }
  if (!conversationClient.includes("receiptId: uploadFor(attachment).receiptId")) {
    failed.push("sendSession file receipt serialization missing");
  }
  if (
    conversationInputSlots.join(",") !==
    OFFICIAL_CONVERSATION_INPUT_SLOTS.join(",")
  ) {
    failed.push(`conversationInputSlots=${conversationInputSlots.join(",")}`);
  }
  if (!fileUploadProtocol.includes(`FILE_UPLOAD_PATH = "${OFFICIAL_FILE_UPLOAD_PATH}"`)) {
    failed.push("missing official uploadFileBinary path");
  }
  if (!fileUploadTypes.includes("FileUploadReceiptId")) {
    failed.push("missing FileUploadReceiptId");
  }
  if (!readmeGenericFiles) failed.push("attachment README no longer documents generic files");
  if (!fileBlockProjectsHandleText) {
    failed.push("FileBlock no longer projects handle text for the model");
  }

  if (failed.length > 0) {
    throw new PenglaiError(
      "DSH_CONTRACT_DRIFT",
      `DSH attachment/prompt contract changed; re-review R56-FILE-016: ${failed.join("; ")}`,
    );
  }

  return {
    requirement: FILE_INTAKE_SPIKE_ID,
    dsh: PINNED_DSH,
    verdict: "GO",
    officialImageMediaTypes,
    contentBlockTypes,
    promptPartTypes,
    conversationInputSlots,
    composerDraftFields,
    genericFileApis,
    fileReceiptField: OFFICIAL_FILE_RECEIPT_FIELD,
    fileUploadPath: OFFICIAL_FILE_UPLOAD_PATH,
    notes: [
      "Official alpha.2 prompt parts are text | image | file. File parts carry a same-Session uploadFile receiptId, not raw bytes.",
      "Composer drafts use createDrafts plus attachmentIds. Image MIME still png/jpeg/webp/gif; every other browser file becomes a file draft with a background upload.",
      "FileBlock is projected to handle text (name, byte size, harness-owned read-only saved path). It is not a native multimodal file part.",
      "Official DSH stores generic files verbatim with no type whitelist or size limit. Penglai Artifact admit-list, size, and macro policy remain Penglai's layer.",
      "Do not bind ordinary files by DOM overlay, second chat, image disguise, or invisible prompt text.",
      "Penglai ArtifactService.bindComposerTurn is not yet wired through official receipts; product copy must not advertise composer DOCX/XLSX/PPTX/PDF until that wiring exists.",
    ],
  };
}

/** Fail closed on unofficial file-to-Turn binding even after the official API exists. */
export function refuseUnofficialFileTurnBinding(): never {
  throw new PenglaiError("DSH_CONTRACT_DRIFT", FILE_INTAKE_UNOFFICIAL_CODE);
}
