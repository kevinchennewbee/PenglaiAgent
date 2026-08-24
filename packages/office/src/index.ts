import { Context } from "@deepseek-ai/cordis";
import { join } from "node:path";
import { ArtifactService } from "@penglai/artifacts";
import { PenglaiError, RELEASE } from "@penglai/contracts";
import { OwnerApprovalBroker } from "@penglai/runtime/owner-broker";
import { createHostOwnerDialog } from "@penglai/runtime/owner-dialog";
import { createOfficeService, type OfficeOutbound } from "./service.js";
import { PenglaiOfficeRemote } from "./remote.js";
import { registerOfficeTools } from "./tools.js";

export const name = "@penglai/office";
export const inject: string[] = ["tools", "workspaceRegistry"];
export const version = RELEASE;
export { createOfficeService, inspect, createDocument, edit, commit, detect } from "./service.js";
export type { OfficeFormat, DocumentInventory, OfficeJob, OfficeOperation } from "./service.js";
export { OFFICE_LIMITS, parseOfficeOperation } from "./operations.js";
export { OFFICE_TEMPLATES } from "./templates/catalog.js";
export { assertAuthorizedBytes } from "./authorization.js";
export { registerOfficeTools } from "./tools.js";
export { loadPenglaiCjkFont, PENGLAI_CJK_FONT_SHA256, PENGLAI_CJK_FONT_LICENSE } from "./cjk-font.js";

interface OfficeContext {
  tools?: { register(definition: Record<string, unknown>): unknown };
  workspaceRegistry?: { list(): Array<{ id: string; title?: string; path?: string; sessionIds?: readonly string[] }> };
  provide?: (name: string, service: unknown) => unknown;
  effect?: (setup: () => () => void) => unknown;
  on?: (event: string, listener: (...args: unknown[]) => unknown) => unknown;
  get?: (name: string, strict?: boolean) => unknown;
}

function requireUserData(): string {
  const root = process.env.PENGLAI_USER_DATA;
  if (!root) throw new PenglaiError("DSH_UNAVAILABLE", "PENGLAI_USER_DATA required for @penglai/office");
  return root;
}

export function apply(ctx: OfficeContext): ReturnType<typeof createOfficeService> {
  const userData = requireUserData();
  if (!ctx.provide) throw new PenglaiError("DSH_UNAVAILABLE", "Cordis provide service required for office");
  if (!ctx.workspaceRegistry?.list) throw new PenglaiError("DSH_UNAVAILABLE", "official Workspace registry required for office");
  const artifacts = new ArtifactService(join(userData, "artifacts"));
  const owner = new OwnerApprovalBroker(userData, {
    dialog: createHostOwnerDialog(userData),
  });
  const svc = createOfficeService({
    userData,
    owner,
    artifacts,
    outbound: () => ctx.get?.("penglaiImCore", true) as OfficeOutbound | undefined,
  });
  registerOfficeTools(ctx, svc);
  ctx.provide("penglaiOffice", svc);
  ctx.effect?.(() => () => {
    artifacts.close();
  });
  if (ctx instanceof Context) new PenglaiOfficeRemote(ctx as Context, svc);
  return svc;
}

Object.assign(apply, { inject });
export default { name, inject, apply, version };
