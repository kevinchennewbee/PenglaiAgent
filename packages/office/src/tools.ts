import { join } from "node:path";
import { PenglaiError } from "@penglai/contracts";
import type { OfficeFormat, OfficeJob, OfficeService } from "./service.js";
import { parseOfficeOperation } from "./operations.js";
import { safeWorkspaceFilename } from "./transaction.js";

interface CordisTools {
  tools?: { register(definition: Record<string, unknown>): unknown };
  workspaceRegistry?: { list(): Array<{ id: string; title?: string; path?: string; sessionIds?: readonly string[] }> };
  on?(event: string, listener: (...args: unknown[]) => unknown): unknown;
}

function jsonOutput(description: string) {
  return {
    schema: { type: "object", additionalProperties: true },
    render: (_args: unknown, value: unknown) => [{ type: "text", text: `${description}\n${JSON.stringify(value)}` }],
  };
}

function boundWorkspace(ctx: CordisTools, exec: unknown): { id: string; path: string; sessionId: string } {
  const bag = exec && typeof exec === "object" ? (exec as Record<string, unknown>) : {};
  const agent = bag.agent && typeof bag.agent === "object" ? (bag.agent as { id?: unknown }) : undefined;
  const agentId = typeof agent?.id === "string" && agent.id ? agent.id : undefined;
  if (!agentId) throw new PenglaiError("UNAUTHORIZED", "office tools require ToolRunContext exec.agent.id");
  if ("workspaceRoot" in bag || "destPath" in bag) {
    throw new PenglaiError("SECURITY_POLICY", "model-supplied workspace paths are not office authorities");
  }
  const workspaces = ctx.workspaceRegistry?.list() ?? [];
  const hit = workspaces.find((row) => row.sessionIds?.includes(agentId) || row.id === agentId);
  if (!hit?.path) throw new PenglaiError("UNAUTHORIZED", "agent is not bound to an official Workspace path");
  return { id: hit.id, path: hit.path, sessionId: agentId };
}

function asFormat(value: unknown): OfficeFormat {
  if (value === "docx" || value === "xlsx" || value === "pptx" || value === "pdf") return value;
  throw new PenglaiError("INVALID_INPUT", "unsupported office format");
}

function publicJob(job: OfficeJob | (OfficeJob & { handle?: string })) {
  return {
    id: job.id,
    format: job.format,
    text: job.text,
    parts: job.parts,
    warnings: job.warnings,
    digest: job.digest,
    ...("handle" in job && job.handle ? { handle: job.handle } : {}),
  };
}

export function registerOfficeTools(ctx: CordisTools, svc: OfficeService): void {
  if (!ctx.tools?.register) throw new PenglaiError("DSH_UNAVAILABLE", "official DSH tools service required for office");
  ctx.on?.("tools/pre-execute", async (...args: unknown[]) => {
    const exec = args[0] as { name?: string };
    const next = args[1] as () => Promise<{ kind: string }>;
    if (
      exec.name === "penglai_office_commit" ||
      exec.name === "penglai_office_undo" ||
      exec.name === "penglai_office_return_to_channel"
    ) {
      return { kind: "ask", reason: "Office write requires Owner confirmation of the exact job, digest, and destination." };
    }
    return next();
  });
  ctx.tools.register({
    name: "penglai_office_inspect",
    description: "Inspect a Workspace document by basename or a session-bound office handle. Paths are taken from the official Workspace, never from the model.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        filename: { type: "string", minLength: 5, maxLength: 80 },
        handle: { type: "string", minLength: 8, maxLength: 80 },
      },
    },
    output: jsonOutput("office inspect"),
    async execute(args: unknown, exec?: unknown) {
      const input = args as { filename?: string; handle?: string; path?: string; workspaceRoot?: string };
      if (input.path || input.workspaceRoot) {
        throw new PenglaiError("SECURITY_POLICY", "office inspect refuses model-supplied paths");
      }
      const ws = boundWorkspace(ctx, exec);
      if (input.handle) return publicJob(await svc.inspectAttached(input.handle, ws.sessionId));
      if (!input.filename) throw new PenglaiError("INVALID_INPUT", "office inspect requires filename or handle");
      return publicJob(await svc.inspectWorkspaceFile(join(ws.path, safeWorkspaceFilename(input.filename)), ws.path, ws.id));
    },
  });
  ctx.tools.register({
    name: "penglai_office_inspect_attached",
    description: "Inspect an office/pdf file bound to the current official Session.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["handle"],
      properties: { handle: { type: "string", minLength: 8, maxLength: 80 } },
    },
    output: jsonOutput("office attached inspect"),
    async execute(args: unknown, exec?: unknown) {
      const ws = boundWorkspace(ctx, exec);
      return publicJob(await svc.inspectAttached(String((args as { handle?: string }).handle), ws.sessionId));
    },
  });
  ctx.tools.register({
    name: "penglai_office_create",
    description: "Create a DOCX, XLSX, PPTX, or PDF from blank text or a built-in template.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        format: { type: "string", enum: ["docx", "xlsx", "pptx", "pdf"] },
        text: { type: "string", minLength: 1, maxLength: 4000 },
        template_id: { type: "string", minLength: 2, maxLength: 40 },
      },
    },
    output: jsonOutput("office create"),
    async execute(args: unknown, exec?: unknown) {
      const input = args as { format?: string; text?: string; template_id?: string };
      const ws = boundWorkspace(ctx, exec);
      if (input.template_id) return publicJob(await svc.createFromTemplate(input.template_id, ws.id));
      if (!input.format || !input.text) throw new PenglaiError("INVALID_INPUT", "office create requires format and text or template_id");
      const created = await svc.create(asFormat(input.format), input.text);
      svc.job(created.id).workspaceId = ws.id;
      svc.job(created.id).sessionId = ws.sessionId;
      return publicJob(created);
    },
  });
  ctx.tools.register({
    name: "penglai_office_plan",
    description: "Apply one closed typed operation to a session-bound office job or attached handle.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["operation"],
      properties: {
        job_id: { type: "string", minLength: 8, maxLength: 80 },
        handle: { type: "string", minLength: 8, maxLength: 80 },
        operation: { type: "object", additionalProperties: true },
      },
    },
    output: jsonOutput("office plan"),
    async execute(args: unknown, exec?: unknown) {
      const input = args as { job_id?: string; handle?: string; operation?: unknown };
      const ws = boundWorkspace(ctx, exec);
      const op = parseOfficeOperation(input.operation);
      if (input.handle) {
        const attached = await svc.inspectAttached(input.handle, ws.sessionId);
        const attachedRecord = svc.job(attached.id);
        const edited = await svc.edit(attached.bytes, op);
        const editedRecord = svc.job(edited.id);
        editedRecord.workspaceId = ws.id;
        editedRecord.sessionId = ws.sessionId;
        if (attachedRecord.attachmentHandle) editedRecord.attachmentHandle = attachedRecord.attachmentHandle;
        if (attachedRecord.routeId) editedRecord.routeId = attachedRecord.routeId;
        return publicJob(edited);
      }
      if (!input.job_id) throw new PenglaiError("INVALID_INPUT", "office plan requires job_id or handle");
      const edited = await svc.edit(svc.job(input.job_id).bytes, op);
      svc.job(edited.id).workspaceId = ws.id;
      svc.job(edited.id).sessionId = ws.sessionId;
      return publicJob(edited);
    },
  });
  ctx.tools.register({
    name: "penglai_office_preview",
    description: "Show the human-readable preview and diff for an office job before Owner approval.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["job_id"],
      properties: { job_id: { type: "string", minLength: 8, maxLength: 80 } },
    },
    output: jsonOutput("office preview"),
    async execute(args: unknown, exec?: unknown) {
      boundWorkspace(ctx, exec);
      const jobId = String((args as { job_id?: string }).job_id);
      const [preview, diff] = await Promise.all([svc.preview(jobId), svc.diff(jobId)]);
      return { preview, diff };
    },
  });
  ctx.tools.register({
    name: "penglai_office_commit",
    description: "Atomically save an approved office job into the current official Workspace using a basename only.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["job_id", "filename"],
      properties: {
        job_id: { type: "string", minLength: 8, maxLength: 80 },
        filename: { type: "string", minLength: 5, maxLength: 80 },
      },
    },
    output: jsonOutput("office commit"),
    async execute(args: unknown, exec?: unknown) {
      const input = args as { job_id?: string; filename?: string; destPath?: string };
      if (input.destPath) throw new PenglaiError("SECURITY_POLICY", "office commit refuses model-supplied destPath");
      const ws = boundWorkspace(ctx, exec);
      const jobId = String(input.job_id);
      const filename = safeWorkspaceFilename(String(input.filename));
      const job = svc.job(jobId);
      if (job.state !== "PREVIEW_READY" && job.state !== "OWNER_APPROVED") {
        throw new PenglaiError("SECURITY_POLICY", "office commit requires preview then Owner confirmation");
      }
      const dest = join(ws.path, filename);
      if (!job.receipt) throw new PenglaiError("SECURITY_POLICY", "office commit requires owner receipt");
      const committed = svc.commitToPath(jobId, job.receipt, dest, ws.path);
      return { dest: committed.dest, digest: committed.digest, backup: committed.backup ? "retained" : undefined };
    },
  });
  ctx.tools.register({
    name: "penglai_office_undo",
    description: "Undo the last office commit if the destination still matches this job's result digest.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["job_id"],
      properties: { job_id: { type: "string", minLength: 8, maxLength: 80 } },
    },
    output: jsonOutput("office undo"),
    async execute(args: unknown, exec?: unknown) {
      boundWorkspace(ctx, exec);
      const jobId = String((args as { job_id?: string }).job_id);
      const receipt = svc.job(jobId).receipt;
      if (!receipt) throw new PenglaiError("SECURITY_POLICY", "office undo requires owner receipt");
      return { bytes: svc.undo(jobId, receipt).length, undone: true };
    },
  });
  ctx.tools.register({
    name: "penglai_office_return_to_channel",
    description: "Export the office job as an outbound artifact bound to the original IM route recorded on the handle.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["job_id"],
      properties: { job_id: { type: "string", minLength: 8, maxLength: 80 } },
    },
    output: jsonOutput("office return"),
    async execute(args: unknown, exec?: unknown) {
      boundWorkspace(ctx, exec);
      const jobId = String((args as { job_id?: string }).job_id);
      const receipt = svc.job(jobId).receipt;
      if (!receipt) throw new PenglaiError("SECURITY_POLICY", "office return requires owner receipt");
      return svc.returnToChannel(jobId, receipt);
    },
  });
}
