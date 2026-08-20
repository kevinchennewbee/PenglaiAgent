import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import type { ProductionCompanionService } from "./index.js";
import type { CompanionDeliveryMode, CompanionIntensity, CompanionLocale, CompanionSignal } from "./service.js";

interface EnableInput {
  bindingId: string;
  workspaceId: string;
  sessionId: string;
  quietStartHour: number;
  quietEndHour: number;
  dailyCap: number;
  recentInteractionMinutes: number;
  intensity: CompanionIntensity;
  deliveryMode: CompanionDeliveryMode;
  locale: CompanionLocale;
  signals: CompanionSignal[];
  ownerConfirmed: boolean;
}

export class PenglaiCompanionRemote extends TypertRemoteService {
  constructor(ctx: Context, private readonly service: ProductionCompanionService) { super(ctx, "penglaiCompanionSettings"); }
  @Remote async status() { await this.service.ready; return { ...this.service.status(), options: this.service.configurationOptions() }; }
  @Remote enable(input: EnableInput) { return this.service.enable(input); }
  @Remote disable(input: { ownerConfirmed: boolean }) { return this.service.disable(input); }
  @Remote scheduleReminder(input: { at: unknown; opaqueReminderId: string; ownerConfirmed: boolean }) { return this.service.scheduleReminder(input); }
}

export const TYPERT_REMOTE = { package: "@penglai/companion", descriptors: ["status", "enable", "disable", "scheduleReminder"] };
