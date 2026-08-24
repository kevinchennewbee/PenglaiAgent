# Upstream issue drafts for DSH 0.1.1-rc.2

DO NOT PUBLISH. Owner authorization is required before creating a GitHub issue.

These drafts exist because Phase 0 spikes proved missing official APIs. They are not Penglai workarounds.

---

## Draft A — generic file Turn binding

Repository: `deepseek-ai/DeepSeek-Harness`

Title: `[dsh-attachment] Add generic file attachment contracts for official Turn binding`

Body:

Problem

Host products need ordinary documents (docx/xlsx/pptx/pdf/txt/md/csv) bound to the same official Session/Turn as the user prompt. Today 0.1.1-rc.2 only admits raster images.

Current behavior

- `ImageMediaType` is `image/png|jpeg|webp|gif`.
- `PromptContentPart` is `text | image`.
- `ContentBlockMap` has text/reasoning/image/tool-call/tool-result. No file block.
- Composer draft is `text` + `imageIds`. `conversation.input.attachments` is a single image-chip slot.
- `@deepseek-ai/dsh-attachment` README: generic files, audio, video, and persistent unsent drafts require separate contracts.
- `SessionReferenceResolver` projects text only.

Requested API

- File media types, `FileAttachmentRef`, `saveFile` / `readFile` on `AttachmentStore`.
- `PromptContentPart` and `ContentBlockMap` file variants.
- Composer draft `fileIds` / `createDraftFiles` / `addFiles`.
- `session.attachment` authorization for file blocks.
- Documented GC/retention.

Acceptance

- A plugin can bind an admitted file ref to `session.prompt` without DOM mutation or a second composer.
- Models receive refs, not filesystem paths.
- Contract tests cover MIME mismatch, size limits, and unknown types.

---

## Draft B — structured curator output

Repository: `deepseek-ai/DeepSeek-Harness`

Title: `[dsh-llm] Add provider-neutral structured output / JSON schema to GenerateOptions`

Body:

Problem

Background curator agents need one official model call with no tools and a host-supplied JSON schema, through `ctx.llm` / `ctx.agents`, without a second HTTP client.

Current behavior

- `GenerateOptions` sampling is temperature/maxTokens/stop. `tools` describes model-facing tool schemas only.
- No `responseFormat`, `json_schema`, or assistant output schema.
- `ToolDefinition.output.schema` applies to tool results, not assistant messages.
- `AgentOptions` is provider/model/maxTokens. `tools: false` is not an official field.
- Official `tools.guard` can deny execution but does not enforce assistant JSON.

Requested API

- `GenerateOptions.responseFormat?: { type: 'json_schema'; schema: JsonSchemaNode; strict?: boolean }`
- Adapter mapping plus a documented degrade path.
- Optional `purpose` extension beside `compaction` | `session-title`.
- Documented no-tools agent mode, or a preset that omits tool schemas from assembly.

Acceptance

- Types in `@deepseek-ai/dsh-llm`.
- At least one first-party adapter honors the field.
- Invalid JSON / schema violation is a typed failure and executes no tools.
