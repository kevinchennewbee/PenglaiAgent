import { Context } from "@deepseek-ai/cordis";
import { RELEASE } from "@penglai/contracts";
import { createOfficeService } from "./service.js";
import { PenglaiOfficeRemote } from "./remote.js";

export const name = "@penglai/office";
export const inject: string[] = [];
export const version = RELEASE;
export { createOfficeService, inspect, createDocument, edit, commit } from "./service.js";
export type { OfficeFormat, DocumentInventory, OfficeJob } from "./service.js";

export function apply(ctx: Pick<Context, "provide"> & { effect?: (setup: () => () => void) => unknown }): ReturnType<typeof createOfficeService> {
  const svc = createOfficeService();
  ctx.provide?.("penglaiOffice", svc);
  ctx.effect?.(() => () => undefined);
  new PenglaiOfficeRemote(ctx as Context, svc);
  return svc;
}
