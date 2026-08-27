import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import type { ProductionCompanionService } from "./index.js";
import type { CompanionEnableInput } from "./service.js";

interface EnableInput extends CompanionEnableInput {
  actionId: string;
  receipt: string;
}

export class PenglaiCompanionRemote extends TypertRemoteService {
  constructor(ctx: Context, private readonly service: ProductionCompanionService) { super(ctx, "penglaiCompanionSettings"); }
  @Remote async status() { await this.service.ready; return { ...this.service.status(), options: this.service.configurationOptions() }; }
  @Remote proposeEnable(input: CompanionEnableInput) { return this.service.proposeEnable(input); }
  @Remote enable(input: EnableInput) { return this.service.enable(input); }
  @Remote proposeDisable() { return this.service.proposeDisable(); }
  @Remote disable(input: { actionId: string; receipt: string }) { return this.service.disable(input); }
  @Remote proposeReminder(input: { at: unknown; opaqueReminderId: string }) { return this.service.proposeReminder(input); }
  @Remote scheduleReminder(input: { at: unknown; opaqueReminderId: string; actionId: string; receipt: string }) { return this.service.scheduleReminder(input); }
}

export const TYPERT_REMOTE = { package: "@penglai/companion", descriptors: ["status", "proposeEnable", "enable", "proposeDisable", "disable", "proposeReminder", "scheduleReminder"] };
