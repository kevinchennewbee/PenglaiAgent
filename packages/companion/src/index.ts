import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { PenglaiError, RELEASE } from "@penglai/contracts";
import { OwnerApprovalBroker } from "@penglai/runtime/owner-broker";
import { createHostOwnerDialog } from "@penglai/runtime/owner-dialog";
import { CompanionStore, type CompanionDispatchRow } from "./scheduler.js";
import {
  FRESH_COMPANION,
  intensitySeconds,
  mayDispatch,
  validateEnableInput,
  type CompanionConfig,
  type CompanionEnableInput,
  type CompanionSignal,
} from "./service.js";
import { PenglaiCompanionRemote } from "./remote.js";
import {
  COMPANION_OWNER_ACTIONS,
  companionDisableDigest,
  companionEnableDigest,
  companionReminderDigest,
  consumeCompanionOwnerProof,
  type CompanionOwnerBrokerPort,
  type CompanionOwnerProof,
} from "./owner.js";

export const name = "@penglai/companion";
export const inject = [
  "agents",
  "workspaceRegistry",
  "tools",
  "sessionPersistence",
  "penglaiBudget",
];
export const version = RELEASE;

interface AgentContextLike {
  tools?: {
    guard(guard: (execution: unknown) => string | undefined): unknown;
    execute(input: {
      callId: string;
      name: string;
      arguments: unknown;
      agent: AgentLike;
      signal: AbortSignal;
    }): Promise<unknown>;
  };
}

interface AgentLike {
  id: string;
  options: { provider?: string; model?: string; maxTokens?: number };
  session: { id?: string; events?: readonly unknown[] };
  ctx: AgentContextLike;
}

interface AgentHandleLike {
  agent: AgentLike;
  dispose(): Promise<void>;
}

interface WorkspaceLike {
  id: string;
  path: string;
  sessionIds: readonly string[];
  attachSession(sessionId: string): Promise<void>;
}

interface ImBindingLike {
  id: string;
  revision: number;
  workspaceId: string;
  sessionId: string;
}

interface ImServiceLike {
  listBindings(): Array<{
    id: string;
    channel: "weixin" | "feishu";
    workspaceId: string;
    sessionId: string;
    state: "active" | "disabled";
  }>;
  requireCompanionBinding(input: {
    bindingId: string;
    workspaceId: string;
    sessionId: string;
  }): ImBindingLike;
  recentUserActivity(bindingId: string): number | undefined;
  sendProactive(input: {
    bindingId: string;
    workspaceId: string;
    boundSessionId: string;
    sourceSessionId: string;
    triggerId: string;
    turnId: string;
    text: string;
    deliveryMode: "text" | "voice" | "text-and-voice";
  }): { outboxIds: string[]; duplicate: boolean };
  cancelProactive?(input: { bindingId: string; triggerIds: string[] }): number;
}

interface BudgetServiceLike {
  assertAffordable(input: {
    provider: string;
    model: string;
    workspaceId?: string;
    estimatedTokens: number;
  }): void;
}

interface CordisContextLike {
  agents?: {
    get(id: string): AgentLike | undefined;
    create(options: {
      sessionId: string;
      meta: { cwd: string };
      agentOptions: AgentLike["options"];
      setup: (agentCtx: AgentContextLike) => void;
    }): Promise<AgentHandleLike>;
    resume(options: {
      resumeSessionId: string;
      agentOptions: AgentLike["options"];
      setup: (agentCtx: AgentContextLike) => void;
    }): Promise<AgentHandleLike>;
  };
  workspaceRegistry?: {
    get(id: string): WorkspaceLike | undefined;
    list(): WorkspaceLike[];
  };
  penglaiImCore?: ImServiceLike;
  penglaiBudget?: BudgetServiceLike;
  get?: (name: string, strict?: boolean) => unknown;
  on?: (
    event: string,
    listener: (...args: unknown[]) => unknown,
    options?: Record<string, unknown>,
  ) => unknown;
  provide?: (serviceName: string, service: unknown) => unknown;
  effect?: (setup: () => () => Promise<void>) => unknown;
}

interface ScheduleOccurrence {
  officialId: string;
  occurrenceAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function messageText(message: unknown): string {
  const content = asRecord(message)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const row = asRecord(block);
      return row?.type === "text" && typeof row.text === "string"
        ? row.text
        : "";
    })
    .join("");
}

function isScheduleMessage(message: unknown): boolean {
  const source = asRecord(asRecord(message)?.source);
  return source?.kind === "plugin" && source.plugin === "schedule";
}

function scheduleOccurrences(message: unknown): ScheduleOccurrence[] {
  if (!isScheduleMessage(message)) return [];
  const text = messageText(message);
  const lines = text.split("\n");
  const idLine = lines.find((line) => line.startsWith("schedule_id_json: "));
  const occurrenceLine = lines.find((line) =>
    line.startsWith("occurrence_at: "),
  );
  if (idLine && occurrenceLine) {
    try {
      const id = JSON.parse(
        idLine.slice("schedule_id_json: ".length),
      ) as unknown;
      if (typeof id === "string" && id)
        return [
          {
            officialId: id,
            occurrenceAt: occurrenceLine.slice("occurrence_at: ".length),
          },
        ];
    } catch {
      return [];
    }
  }
  const batchLine = lines.find((line) => line.startsWith("reminders_json: "));
  if (!batchLine) return [];
  try {
    const values = JSON.parse(
      batchLine.slice("reminders_json: ".length),
    ) as unknown;
    if (!Array.isArray(values)) return [];
    return values.flatMap((value) => {
      const row = asRecord(value);
      return typeof row?.schedule_id === "string" &&
        typeof row.occurrence_at === "string"
        ? [{ officialId: row.schedule_id, occurrenceAt: row.occurrence_at }]
        : [];
    });
  } catch {
    return [];
  }
}

function triggerId(sessionId: string, occurrence: ScheduleOccurrence): string {
  return `comp_${createHash("sha256")
    .update(
      `${sessionId}\0${occurrence.officialId}\0${occurrence.occurrenceAt}`,
    )
    .digest("hex")}`;
}

function fixedPrompt(
  config: CompanionConfig,
  triggerClass: CompanionSignal,
  opaqueId: string,
): string {
  const intent =
    config.locale === "zh"
      ? "生成一条简短、温和、不施压的主动陪伴消息。不要调用任何工具，不要声称看过未授权信息。"
      : "Write one brief, warm, low-pressure proactive check-in. Do not call tools or claim access to unapproved information.";
  const opaqueDigest = createHash("sha256").update(opaqueId).digest("hex");
  return `[PENGLAI COMPANION v1]\npolicy_revision=${config.revision}\ntrigger_class=${triggerClass}\nopaque_signal=${opaqueDigest}\n${intent}`;
}

function resolveIm(ctx: CordisContextLike): ImServiceLike | undefined {
  if (typeof ctx.get === "function") {
    // Cordis Context.get() is the supported optional-service lookup. Falling
    // through to the proxy property when it returns undefined would trigger
    // Cordis' mandatory-inject guard and crash Companion when IM is disabled.
    return ctx.get("penglaiImCore", true) as ImServiceLike | undefined;
  }
  return ctx.penglaiImCore;
}

function scheduleMarker(triggerClass: CompanionSignal, opaqueId: string): string {
  const opaqueDigest = createHash("sha256").update(opaqueId).digest("hex");
  return `[PENGLAI COMPANION TRIGGER v1]\ntrigger_class=${triggerClass}\nopaque_signal=${opaqueDigest}`;
}

function stableOutcome(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  if (/quiet hours/.test(error.message)) return "quiet_hours";
  if (/daily cap/.test(error.message)) return "daily_cap";
  if (/recent interaction/.test(error.message)) return "recent_interaction";
  if (/binding/.test(error.message)) return "binding_unavailable";
  if (/default-off/.test(error.message)) return "disabled";
  return error instanceof PenglaiError
    ? error.errorClass.toLowerCase()
    : "runtime_error";
}

function requireUserData(): string {
  const value = process.env.PENGLAI_USER_DATA;
  if (!value)
    throw new PenglaiError(
      "DSH_UNAVAILABLE",
      "PENGLAI_USER_DATA required for @penglai/companion",
    );
  return value;
}

export class ProductionCompanionService {
  private handle: AgentHandleLike | undefined;
  private listenerDisposers: Array<() => unknown> = [];
  private readonly ownerOperations = new AsyncLocalStorage<symbol>();
  private readonly ownerToken = Symbol("companion-owner-operation");
  private readonly finalText = new Map<string, string>();
  private readonly inflight = new Set<Promise<void>>();
  private closing = false;
  private runtimeError: string | undefined;
  readonly ready: Promise<void>;

  constructor(
    private readonly ctx: CordisContextLike,
    readonly store: CompanionStore,
    private readonly now: () => number = Date.now,
    private readonly owner?: CompanionOwnerBrokerPort,
  ) {
    if (!ctx.agents?.get || !ctx.agents.create || !ctx.agents.resume) {
      throw new PenglaiError(
        "DSH_UNAVAILABLE",
        "official Agents create/resume required for companion",
      );
    }
    if (!ctx.workspaceRegistry?.get || !ctx.workspaceRegistry.list) {
      throw new PenglaiError(
        "DSH_UNAVAILABLE",
        "official Workspace registry required for companion",
      );
    }
    const im = resolveIm(ctx);
    if (
      !im?.listBindings ||
      !im.requireCompanionBinding ||
      !im.sendProactive
    ) {
      this.runtimeError = "connect a messaging platform first";
    }
    if (!ctx.on)
      throw new PenglaiError(
        "DSH_UNAVAILABLE",
        "official agent/session events required for companion",
      );
    this.ready = this.bootstrap().catch((error) => {
      this.runtimeError =
        error instanceof Error ? error.message : String(error);
    });
  }

  private async bootstrap(): Promise<void> {
    const config = this.store.config();
    if (!config.enabled) return;
    this.attachListeners();
    try {
      const agent = await this.resumeDedicated(config);
      await this.replay(agent);
    } catch (error) {
      this.detachListeners();
      throw error;
    }
  }

  private setupAgentContext(agentCtx: AgentContextLike): void {
    if (!agentCtx.tools?.guard)
      throw new PenglaiError(
        "DSH_UNAVAILABLE",
        "official Tools guard required for companion",
      );
    agentCtx.tools.guard((execution) => {
      const toolName = String(asRecord(execution)?.name ?? "");
      const ownerCall = this.ownerOperations.getStore() === this.ownerToken;
      if (
        ownerCall &&
        ["schedule_create", "schedule_list", "schedule_delete"].includes(
          toolName,
        )
      )
        return undefined;
      return "companion plan/no-unattended-tools";
    });
  }

  private attachListeners(): void {
    if (this.listenerDisposers.length) return;
    const register = (
      event: string,
      listener: (...args: unknown[]) => unknown,
      options?: Record<string, unknown>,
    ) => {
      const disposer = this.ctx.on!(event, listener, options);
      if (typeof disposer === "function")
        this.listenerDisposers.push(disposer as () => unknown);
    };
    register("agent/inbox/claimed", (payload) => this.onClaimed(payload));
    register(
      "agent/pre-step",
      (payload, next) => this.onPreStep(payload, next),
      { global: true, prepend: true },
    );
    register("session/event", (...args) => this.onSessionEvent(args));
  }

  private detachListeners(): void {
    for (const dispose of this.listenerDisposers.splice(0).reverse()) dispose();
  }

  private onClaimed(payload: unknown): void {
    const config = this.store.config();
    if (!config.enabled || !config.companionSessionId) return;
    const row = asRecord(payload);
    const agent = asRecord(row?.agent);
    const turn = row?.turn;
    const message = row?.message;
    if (
      String(agent?.id ?? "") !== config.companionSessionId ||
      typeof turn !== "number"
    )
      return;
    this.claimOccurrences(config.companionSessionId, turn, message);
  }

  private claimOccurrences(
    sessionId: string,
    turn: number,
    message: unknown,
  ): void {
    for (const occurrence of scheduleOccurrences(message)) {
      const schedule = this.store.scheduleByOfficialId(occurrence.officialId);
      if (!schedule || schedule.state !== "active") continue;
      this.store.claimDispatch(
        {
          triggerId: triggerId(sessionId, occurrence),
          officialId: occurrence.officialId,
          triggerClass: schedule.triggerClass,
          occurrenceAt: occurrence.occurrenceAt,
          sessionId,
          turn,
          policyRevision: schedule.policyRevision,
        },
        this.now(),
      );
    }
  }

  private async onPreStep(payload: unknown, next: unknown): Promise<unknown> {
    const row = asRecord(payload);
    const agent = asRecord(row?.agent);
    const turn = row?.turn;
    const config = this.store.config();
    if (String(agent?.id ?? "") !== config.companionSessionId) {
      return typeof next === "function"
        ? (next as () => unknown)()
        : { kind: "reject" };
    }
    if (typeof turn !== "number" || typeof next !== "function")
      return { kind: "reject" };
    const dispatch = this.store.dispatchByTurn(
      config.companionSessionId!,
      turn,
    );
    if (
      !dispatch ||
      dispatch.state !== "claimed" ||
      dispatch.policyRevision !== config.revision
    ) {
      if (dispatch?.state === "claimed")
        this.store.markDispatch(dispatch.triggerId, "suppressed", this.now(), {
          outcomeCode: "policy_stale",
        });
      return { kind: "reject" };
    }
    try {
      this.assertDispatchAllowed(config);
      const decision = asRecord(await (next as () => unknown)());
      if (decision?.kind !== "enter" || !Array.isArray(decision.messages)) {
        this.store.markDispatch(dispatch.triggerId, "suppressed", this.now(), {
          outcomeCode: "downstream_rejected",
        });
        return decision ?? { kind: "reject" };
      }
      let replaced = false;
      const messages = decision.messages.map((message) => {
        if (!isScheduleMessage(message)) return message;
        replaced = true;
        return {
          ...asRecord(message),
          content: [
            {
              type: "text",
              text: fixedPrompt(config, dispatch.triggerClass, dispatch.triggerId),
            },
          ],
          source: { kind: "plugin", plugin: "penglai-companion" },
        };
      });
      if (!replaced) {
        this.store.markDispatch(dispatch.triggerId, "suppressed", this.now(), {
          outcomeCode: "schedule_message_missing",
        });
        return { kind: "reject" };
      }
      this.store.markDispatch(dispatch.triggerId, "turn_running", this.now());
      return { ...decision, messages };
    } catch (error) {
      this.store.markDispatch(dispatch.triggerId, "suppressed", this.now(), {
        outcomeCode: stableOutcome(error),
      });
      return { kind: "reject" };
    }
  }

  private assertDispatchAllowed(config: CompanionConfig): void {
    const im = resolveIm(this.ctx);
    if (!im) {
      throw new PenglaiError("DSH_UNAVAILABLE", "connect a messaging platform first");
    }
    const recent = im.recentUserActivity(config.bindingId!);
    mayDispatch(config, this.now(), this.store.sentOn(this.now()), recent);
    im.requireCompanionBinding({
      bindingId: config.bindingId!,
      workspaceId: config.workspaceId!,
      sessionId: config.boundSessionId!,
    });
    // Budget is a hard gate ahead of any companion Turn: if the model route's
    // hard limit is already reached, a proactive trigger must not fire at all.
    if (config.provider && config.model) {
      this.ctx.penglaiBudget?.assertAffordable({
        provider: config.provider,
        model: config.model,
        ...(config.workspaceId ? { workspaceId: config.workspaceId } : {}),
        estimatedTokens: 1,
      });
    }
  }

  private onSessionEvent(args: unknown[]): void {
    const session = asRecord(args[0]);
    const event = asRecord(args[1]);
    const config = this.store.config();
    if (!event || String(session?.id ?? "") !== config.companionSessionId)
      return;
    const data = asRecord(event.data);
    const turn = data?.turn;
    if (typeof turn !== "number") return;
    const key = `${config.companionSessionId}:${turn}`;
    if (event.type === "assistant/message") {
      const text = messageText(data?.message);
      if (text.trim()) this.finalText.set(key, text);
      return;
    }
    if (event.type !== "turn/end") return;
    const text = this.finalText.get(key);
    this.finalText.delete(key);
    const dispatch = this.store.dispatchByTurn(
      config.companionSessionId!,
      turn,
    );
    if (!dispatch || dispatch.state !== "turn_running") return;
    if (!text) {
      this.store.markDispatch(dispatch.triggerId, "failed", this.now(), {
        outcomeCode: "no_durable_final",
      });
      return;
    }
    this.track(this.queueDelivery(dispatch, text));
  }

  private track(task: Promise<void>): void {
    const tracked = task.finally(() => this.inflight.delete(tracked));
    this.inflight.add(tracked);
  }

  private async queueDelivery(
    dispatch: CompanionDispatchRow,
    text: string,
  ): Promise<void> {
    if (this.closing) return;
    const config = this.store.config();
    if (dispatch.state === "outbox_queued" || dispatch.state === "suppressed")
      return;
    try {
      this.assertDispatchAllowed(config);
      if (dispatch.policyRevision !== config.revision)
        throw new PenglaiError("SECURITY_POLICY", "companion policy stale");
      const result = resolveIm(this.ctx)!.sendProactive({
        bindingId: config.bindingId!,
        workspaceId: config.workspaceId!,
        boundSessionId: config.boundSessionId!,
        sourceSessionId: dispatch.sessionId,
        triggerId: dispatch.triggerId,
        turnId: String(dispatch.turn),
        text,
        deliveryMode: config.deliveryMode === "text+voice" ? "text-and-voice" : config.deliveryMode,
      });
      this.store.markDispatch(dispatch.triggerId, "outbox_queued", this.now(), {
        routeId: config.bindingId!,
        finalDigest: createHash("sha256").update(text).digest("hex"),
        outboxRefs: result.outboxIds,
      });
    } catch (error) {
      const code = stableOutcome(error);
      const state =
        error instanceof PenglaiError &&
        error.errorClass === "DELIVERY_TRANSIENT"
          ? "uncertain"
          : "suppressed";
      this.store.markDispatch(dispatch.triggerId, state, this.now(), {
        outcomeCode: code,
      });
    }
  }

  private async replay(agent: AgentLike): Promise<void> {
    let turn: number | undefined;
    const finals = new Map<number, string>();
    for (const value of agent.session.events ?? []) {
      const event = asRecord(value);
      const data = asRecord(event?.data);
      if (event?.type === "turn/start" && typeof data?.turn === "number")
        turn = data.turn;
      if (event?.type === "user/message" && turn !== undefined)
        this.claimOccurrences(agent.id, turn, event.data);
      if (
        event?.type === "assistant/message" &&
        typeof data?.turn === "number"
      ) {
        const text = messageText(data.message);
        if (text.trim()) finals.set(data.turn, text);
      }
      if (event?.type === "turn/end" && typeof data?.turn === "number") {
        const dispatch = this.store.dispatchByTurn(agent.id, data.turn);
        if (dispatch?.state === "claimed") {
          try {
            this.assertDispatchAllowed(this.store.config());
            this.store.markDispatch(
              dispatch.triggerId,
              "turn_running",
              this.now(),
            );
          } catch (error) {
            this.store.markDispatch(
              dispatch.triggerId,
              "suppressed",
              this.now(),
              { outcomeCode: stableOutcome(error) },
            );
          }
        }
        const current = this.store.dispatchByTurn(agent.id, data.turn);
        const text = finals.get(data.turn);
        if (current?.state === "turn_running" && text)
          await this.queueDelivery(current, text);
        else if (current?.state === "turn_running") {
          this.store.markDispatch(current.triggerId, "failed", this.now(), {
            outcomeCode: "no_durable_final",
          });
        }
        turn = undefined;
      }
    }
  }

  private async createDedicated(config: CompanionConfig): Promise<AgentLike> {
    if (
      !config.companionSessionId ||
      !config.workspacePath ||
      !config.provider ||
      !config.model
    ) {
      throw new PenglaiError(
        "STORE_CORRUPT",
        "companion creation identity missing",
      );
    }
    const raw = await this.ctx.agents!.create({
      sessionId: config.companionSessionId,
      meta: { cwd: config.workspacePath },
      agentOptions: { provider: config.provider, model: config.model },
      setup: (agentCtx) => this.setupAgentContext(agentCtx),
    });
    if (!raw?.agent || typeof raw.dispose !== "function")
      throw new PenglaiError(
        "DSH_CONTRACT_DRIFT",
        "official Agent handle missing",
      );
    this.handle = raw;
    return raw.agent;
  }

  private async resumeDedicated(config: CompanionConfig): Promise<AgentLike> {
    if (!config.companionSessionId || !config.provider || !config.model) {
      throw new PenglaiError(
        "STORE_CORRUPT",
        "companion resume identity missing",
      );
    }
    if (this.ctx.agents!.get(config.companionSessionId)) {
      throw new PenglaiError(
        "SECURITY_POLICY",
        "companion refuses an unowned live Agent",
      );
    }
    const provider = config.provider;
    const model = config.model;
    const raw = await this.ctx.agents!.resume({
      resumeSessionId: config.companionSessionId,
      agentOptions: { provider, model },
      setup: (agentCtx) => this.setupAgentContext(agentCtx),
    });
    if (!raw?.agent || typeof raw.dispose !== "function")
      throw new PenglaiError(
        "DSH_CONTRACT_DRIFT",
        "official Agent handle missing",
      );
    this.handle = raw;
    return raw.agent;
  }

  private async ownerTool(
    agent: AgentLike,
    toolName: "schedule_create" | "schedule_delete",
    args: unknown,
  ): Promise<Record<string, unknown>> {
    if (!agent.ctx.tools?.execute)
      throw new PenglaiError(
        "DSH_UNAVAILABLE",
        "official Schedule tools missing",
      );
    const controller = new AbortController();
    const result = await this.ownerOperations.run(this.ownerToken, () =>
      agent.ctx.tools!.execute({
        callId: `companion-owner-${randomUUID()}`,
        name: toolName,
        arguments: args,
        agent,
        signal: controller.signal,
      }),
    );
    const row = asRecord(result);
    if (!row || row.isError === true) {
      const error = asRecord(row?.error);
      throw new PenglaiError(
        "DSH_UNAVAILABLE",
        `official ${toolName} failed: ${String(error?.message ?? "unknown")}`,
      );
    }
    const value = asRecord(row.value);
    if (!value)
      throw new PenglaiError(
        "DSH_CONTRACT_DRIFT",
        `official ${toolName} value missing`,
      );
    return value;
  }

  private async addOfficialSchedule(
    agent: AgentLike,
    config: CompanionConfig,
    triggerClass: CompanionSignal,
    opaqueId: string,
    selector:
      { every_seconds: number } | { after_seconds: number } | { at: unknown },
  ): Promise<string> {
    const value = await this.ownerTool(agent, "schedule_create", {
      prompt: scheduleMarker(triggerClass, opaqueId),
      ...selector,
    });
    const officialId = String(value.id ?? "");
    if (!officialId)
      throw new PenglaiError(
        "DSH_CONTRACT_DRIFT",
        "official schedule id missing",
      );
    this.store.addSchedule(
      {
        localId: `local-${randomUUID()}`,
        officialId,
        triggerClass,
        policyRevision: config.revision,
        state: "active",
      },
      this.now(),
    );
    return officialId;
  }

  proposeEnable(input: CompanionEnableInput): { actionId: string } {
    validateEnableInput(input);
    if (!this.owner) throw new PenglaiError("DSH_UNAVAILABLE", "companion owner broker required");
    return this.owner.createProposal({
      action: COMPANION_OWNER_ACTIONS.enable,
      pluginId: name,
      objectId: input.bindingId,
      sourceDigest: companionEnableDigest(input),
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
    });
  }

  async enable(
    input: CompanionEnableInput & CompanionOwnerProof,
  ): Promise<CompanionConfig> {
    await this.ready;
    validateEnableInput(input);
    if (this.store.config().enabled)
      throw new PenglaiError("INVALID_INPUT", "companion already enabled");
    const im = resolveIm(this.ctx);
    if (!im?.requireCompanionBinding) {
      throw new PenglaiError("DSH_UNAVAILABLE", "connect a messaging platform first");
    }
    if (!im.listBindings().some((row) => row.state === "active")) {
      throw new PenglaiError("DSH_UNAVAILABLE", "connect a messaging platform first");
    }
    const binding = im.requireCompanionBinding({
      bindingId: input.bindingId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
    });
    const workspace = this.ctx.workspaceRegistry!.get(input.workspaceId);
    const source = this.ctx.agents!.get(input.sessionId);
    if (!workspace || !source)
      throw new PenglaiError(
        "DSH_UNAVAILABLE",
        "selected Workspace/Session must be live for companion enable",
      );
    const provider = source.options.provider;
    const model = source.options.model;
    if (!provider || !model)
      throw new PenglaiError(
        "DSH_UNAVAILABLE",
        "selected Session model route missing",
      );
    const complete = consumeCompanionOwnerProof(this.owner, {
      actionId: input.actionId,
      receipt: input.receipt,
      action: COMPANION_OWNER_ACTIONS.enable,
      objectId: input.bindingId,
      sourceDigest: companionEnableDigest(input),
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
    });
    const companionSessionId = `penglai-companion-${randomUUID()}`;
    const enabling = this.store.beginEnable(
      {
        bindingId: binding.id,
        workspaceId: workspace.id,
        boundSessionId: source.id,
        companionSessionId,
        provider,
        model,
        workspacePath: workspace.path,
        quietStartHour: input.quietStartHour,
        quietEndHour: input.quietEndHour,
        dailyCap: input.dailyCap,
        recentInteractionMinutes: input.recentInteractionMinutes,
        intensity: input.intensity,
        deliveryMode: input.deliveryMode,
        locale: input.locale,
        signals: [...input.signals],
      },
      this.now(),
    );
    this.attachListeners();
    try {
      const agent = await this.createDedicated(enabling);
      await workspace.attachSession(agent.id);
      if (enabling.signals.includes("periodic")) {
        await this.addOfficialSchedule(
          agent,
          enabling,
          "periodic",
          `periodic:${enabling.revision}`,
          {
            every_seconds: intensitySeconds(enabling.intensity),
          },
        );
      }
      this.runtimeError = undefined;
      const committed = this.store.commitEnable(this.now());
      complete({ enabled: committed.enabled, revision: committed.revision });
      return committed;
    } catch (error) {
      this.store.failEnable(stableOutcome(error), this.now());
      await this.handle?.dispose().catch(() => undefined);
      this.handle = undefined;
      this.detachListeners();
      throw error;
    }
  }

  async triggerSignal(input: {
    signal: "idle" | "emotion";
    opaqueSignalId: string;
  }): Promise<{ officialId: string }> {
    await this.ready;
    const config = this.store.config();
    if (!config.enabled || !config.signals.includes(input.signal)) {
      throw new PenglaiError("SECURITY_POLICY", "companion signal not enabled");
    }
    if (!/^[A-Za-z0-9_.:-]{8,160}$/.test(input.opaqueSignalId)) {
      throw new PenglaiError(
        "INVALID_INPUT",
        "opaque companion signal id invalid",
      );
    }
    const agent = this.handle?.agent;
    if (!agent)
      throw new PenglaiError("DSH_UNAVAILABLE", "companion Agent unavailable");
    return {
      officialId: await this.addOfficialSchedule(
        agent,
        config,
        input.signal,
        input.opaqueSignalId,
        { after_seconds: 1 },
      ),
    };
  }

  proposeReminder(input: {
    at: unknown;
    opaqueReminderId: string;
  }): { actionId: string } {
    const config = this.store.config();
    if (!config.enabled || !config.signals.includes("reminder")) {
      throw new PenglaiError("SECURITY_POLICY", "companion reminder not enabled");
    }
    if (!/^[A-Za-z0-9_.:-]{8,160}$/.test(input.opaqueReminderId)) {
      throw new PenglaiError("INVALID_INPUT", "opaque companion reminder id invalid");
    }
    if (!this.owner) throw new PenglaiError("DSH_UNAVAILABLE", "companion owner broker required");
    return this.owner.createProposal({
      action: COMPANION_OWNER_ACTIONS.scheduleReminder,
      pluginId: name,
      objectId: input.opaqueReminderId,
      sourceDigest: companionReminderDigest({ ...input, configRevision: config.revision }),
      ...(config.workspaceId ? { workspaceId: config.workspaceId } : {}),
      ...(config.boundSessionId ? { sessionId: config.boundSessionId } : {}),
    });
  }

  async scheduleReminder(input: {
    at: unknown;
    opaqueReminderId: string;
  } & CompanionOwnerProof): Promise<{ officialId: string }> {
    await this.ready;
    const config = this.store.config();
    if (!config.enabled || !config.signals.includes("reminder")) {
      throw new PenglaiError("SECURITY_POLICY", "companion reminder not authorized");
    }
    if (!/^[A-Za-z0-9_.:-]{8,160}$/.test(input.opaqueReminderId)) {
      throw new PenglaiError("INVALID_INPUT", "opaque companion reminder id invalid");
    }
    const agent = this.handle?.agent;
    if (!agent)
      throw new PenglaiError("DSH_UNAVAILABLE", "companion Agent unavailable");
    const complete = consumeCompanionOwnerProof(this.owner, {
      actionId: input.actionId,
      receipt: input.receipt,
      action: COMPANION_OWNER_ACTIONS.scheduleReminder,
      objectId: input.opaqueReminderId,
      sourceDigest: companionReminderDigest({ ...input, configRevision: config.revision }),
      ...(config.workspaceId ? { workspaceId: config.workspaceId } : {}),
      ...(config.boundSessionId ? { sessionId: config.boundSessionId } : {}),
    });
    const result = {
      officialId: await this.addOfficialSchedule(
        agent,
        config,
        "reminder",
        input.opaqueReminderId,
        { at: input.at },
      ),
    };
    complete(result);
    return result;
  }

  proposeDisable(): { actionId: string } {
    const config = this.store.config();
    if (!config.enabled) throw new PenglaiError("INVALID_INPUT", "companion already disabled");
    if (!this.owner) throw new PenglaiError("DSH_UNAVAILABLE", "companion owner broker required");
    return this.owner.createProposal({
      action: COMPANION_OWNER_ACTIONS.disable,
      pluginId: name,
      objectId: config.bindingId ?? "companion",
      sourceDigest: companionDisableDigest(config),
      ...(config.workspaceId ? { workspaceId: config.workspaceId } : {}),
      ...(config.boundSessionId ? { sessionId: config.boundSessionId } : {}),
    });
  }

  async disable(input: CompanionOwnerProof): Promise<CompanionConfig> {
    await this.ready;
    const before = this.store.config();
    if (!before.enabled)
      throw new PenglaiError("INVALID_INPUT", "companion already disabled");
    const complete = consumeCompanionOwnerProof(this.owner, {
      actionId: input.actionId,
      receipt: input.receipt,
      action: COMPANION_OWNER_ACTIONS.disable,
      objectId: before.bindingId ?? "companion",
      sourceDigest: companionDisableDigest(before),
      ...(before.workspaceId ? { workspaceId: before.workspaceId } : {}),
      ...(before.boundSessionId ? { sessionId: before.boundSessionId } : {}),
    });
    const disabled = this.store.disable(this.now());
    const triggerIds = this.store
      .dispatches()
      .filter((row) => row.state === "outbox_queued")
      .map((row) => row.triggerId);
    if (before.bindingId && triggerIds.length) {
      resolveIm(this.ctx)?.cancelProactive?.({
        bindingId: before.bindingId,
        triggerIds,
      });
    }
    const agent = this.handle?.agent;
    if (agent) {
      for (const schedule of this.store.schedules(true)) {
        try {
          const value = await this.ownerTool(agent, "schedule_delete", {
            id: schedule.officialId,
          });
          if (value.deleted === true || value.code === "schedule_not_found")
            this.store.markScheduleDeleted(schedule.officialId);
        } catch {
          /* Disabled config and Agent disposal remain the fail-closed boundary. */
        }
      }
    }
    await this.handle?.dispose();
    this.handle = undefined;
    this.detachListeners();
    await Promise.allSettled([...this.inflight]);
    complete({ enabled: disabled.enabled, revision: disabled.revision });
    return disabled;
  }

  status(): {
    config: CompanionConfig;
    schedules: ReturnType<CompanionStore["schedules"]>;
    dispatches: CompanionDispatchRow[];
    resources: { agent: number; listeners: number; inflight: number };
    runtimeError?: string;
  } {
    return {
      config: this.store.config(),
      schedules: this.store.schedules(),
      dispatches: this.store.dispatches(),
      resources: {
        agent: this.handle ? 1 : 0,
        listeners: this.listenerDisposers.length,
        inflight: this.inflight.size,
      },
      ...(this.runtimeError ? { runtimeError: this.runtimeError } : {}),
    };
  }

  configurationOptions(): {
    bindings: Array<{ id: string; channel: "weixin" | "feishu"; workspaceId: string; sessionId: string }>;
    workspaces: Array<{ id: string; sessions: Array<{ id: string; provider: string; model: string }> }>;
  } {
    const workspaces = this.ctx.workspaceRegistry!.list().map((workspace) => ({
      id: workspace.id,
      sessions: workspace.sessionIds.flatMap((sessionId) => {
        const agent = this.ctx.agents!.get(sessionId);
        const provider = agent?.options.provider;
        const model = agent?.options.model;
        return agent && provider && model ? [{ id: agent.id, provider, model }] : [];
      }),
    }));
    return {
      bindings: (resolveIm(this.ctx)?.listBindings() ?? [])
        .filter((binding) => binding.state === "active")
        .map(({ id, channel, workspaceId, sessionId }) => ({ id, channel, workspaceId, sessionId })),
      workspaces,
    };
  }

  resourceSnapshot() {
    const resources = this.status().resources;
    return {
      workers: resources.agent,
      sockets: 0,
      timers: resources.listeners,
      remotes: 0,
      db: this.closing ? 0 : 1,
      modelSessions: 0,
      audioHandles: 0,
    };
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.detachListeners();
    await Promise.allSettled([...this.inflight]);
    await this.handle?.dispose().catch(() => undefined);
    this.handle = undefined;
    this.store.close();
  }
}

export function createCompanionService() {
  return {
    name,
    version,
    config: { ...FRESH_COMPANION },
    mayDispatch: (now: number) => mayDispatch(FRESH_COMPANION, now, 0),
  };
}

export function apply(ctx: CordisContextLike) {
  const userData = requireUserData();
  if (!ctx.provide)
    throw new PenglaiError(
      "DSH_UNAVAILABLE",
      "Cordis provide service required for companion",
    );
  if (!ctx.effect)
    throw new PenglaiError(
      "DSH_UNAVAILABLE",
      "Cordis effect lifecycle required for companion",
    );
  const store = new CompanionStore(
    join(userData, "companion", "companion.sqlite3"),
  );
  try {
    const owner = new OwnerApprovalBroker(userData, {
      dialog: createHostOwnerDialog(userData),
    });
    const service = new ProductionCompanionService(ctx, store, Date.now, owner);
    ctx.provide("penglaiCompanion", service);
    if (ctx instanceof Context) new PenglaiCompanionRemote(ctx, service);
    ctx.effect(() => () => service.close());
    return service;
  } catch (error) {
    store.close();
    throw error;
  }
}

Object.assign(apply, { inject });
export default { name, inject, apply, version };
export * from "./service.js";
export * from "./scheduler.js";
