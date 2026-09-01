import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { isPenglaiRemoteContext, PenglaiError, RELEASE } from "@penglai/contracts";
import { BudgetLedger, type BudgetIdentity, type BudgetScope } from "./ledger.js";
import { BudgetGate, type BudgetLimit, type TokenMeterFact } from "./service.js";
import { createBudgetSettingsApi, PenglaiBudgetRemote } from "./remote.js";
import { OwnerApprovalBroker } from "@penglai/runtime/owner-broker";
import { createHostOwnerDialog } from "@penglai/runtime/owner-dialog";
import { BUDGET_OWNER_ACTION, budgetPolicyObjectId, budgetSourceDigest, type BudgetOwnerBrokerPort } from "./owner.js";

export const name = "@penglai/budget";
export const inject = ["tokenMeter", "agents", "workspaceRegistry"];
export const version = RELEASE;

export function createBudgetService(
  limit: BudgetLimit = { hardTokens: null },
  now: () => number = Date.now,
  ledgerPath?: string,
) {
  const ledger = ledgerPath ? new BudgetLedger(ledgerPath) : undefined;
  const gate = new BudgetGate(limit, now, ledger);
  return { name, version, gate, ledger };
}

interface AgentLike {
  id: string;
  session: { events?: readonly unknown[] };
  options?: { provider?: string; model?: string; maxTokens?: number };
}

interface ModelRoute {
  provider?: string;
  model?: string;
}

interface CordisContextLike {
  tokenMeter?: { measure(session: unknown): { totalTokens: number } };
  agents?: { list(): AgentLike[] };
  workspaceRegistry?: { list(): Array<{ id: string; sessionIds?: readonly string[] }> };
  on?: (event: string, listener: (...args: unknown[]) => unknown, options?: Record<string, unknown>) => unknown;
  provide?: (name: string, service: unknown) => unknown;
  effect?: (setup: () => () => void) => unknown;
}

function requireUserData(): string {
  const root = process.env.PENGLAI_USER_DATA;
  if (!root) throw new PenglaiError("DSH_UNAVAILABLE", "PENGLAI_USER_DATA required for @penglai/budget");
  return root;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function usageTokens(value: unknown): number | undefined {
  const usage = asRecord(value);
  if (!usage) return undefined;
  const fields = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens];
  let total = 0;
  let observed = false;
  for (const field of fields) {
    if (field === undefined) continue;
    if (!Number.isSafeInteger(field) || Number(field) < 0) return undefined;
    total += Number(field);
    observed = true;
  }
  return observed && Number.isSafeInteger(total) ? total : undefined;
}

function identityFor(ctx: CordisContextLike, agent: AgentLike, route: ModelRoute): BudgetIdentity {
  const provider = route.provider;
  const model = route.model;
  if (!provider || !model) throw new PenglaiError("DSH_UNAVAILABLE", "official agent model identity missing");
  const workspace = ctx.workspaceRegistry?.list().find((row) => row.sessionIds?.includes(agent.id));
  return { provider, model, ...(workspace ? { workspaceId: workspace.id } : {}) };
}

export function createProductionBudgetService(ctx: CordisContextLike, ledger: BudgetLedger, now: () => number = Date.now) {
  if (!ctx.tokenMeter?.measure) throw new PenglaiError("DSH_UNAVAILABLE", "official TokenMeter required for budget");
  if (!ctx.agents?.list) throw new PenglaiError("DSH_UNAVAILABLE", "official Agents registry required for budget");
  if (!ctx.workspaceRegistry?.list) throw new PenglaiError("DSH_UNAVAILABLE", "official Workspace registry required for budget");
  if (!ctx.on) throw new PenglaiError("DSH_UNAVAILABLE", "official agent lifecycle events required for budget");

  ctx.on(
    "agent/request",
    async (...args: unknown[]) => {
      const payload = asRecord(args[0]);
      const next = args[1];
      const agent = payload?.agent as AgentLike | undefined;
      const turn = payload?.turn;
      const step = payload?.step;
      if (!agent || typeof turn !== "number" || typeof step !== "number" || typeof next !== "function") {
        throw new PenglaiError("DSH_UNAVAILABLE", "official request payload missing");
      }
      // When the agent already declares its model route, block a new Turn
      // *before* invoking next(). This keeps the hard limit ahead of the
      // official model invocation even if next() itself is the call that
      // triggers the provider; the post-next admit still reserves the exact
      // resolved route for accounting.
      const declared = agent.options;
      const measured = ctx.tokenMeter!.measure(agent.session);
      const estimatedTokens = Math.max(1, measured.totalTokens);
      if (!Number.isSafeInteger(estimatedTokens)) throw new PenglaiError("DSH_UNAVAILABLE", "official TokenMeter returned invalid tokens");
      if (step === 1 && declared?.provider && declared.model) {
        ledger.assertWithinBudget(
          {
            estimatedTokens,
            identity: identityFor(ctx, agent, { provider: declared.provider, model: declared.model }),
          },
          now(),
        );
      }
      const route = asRecord(await (next as () => Promise<unknown>)());
      if (!route) throw new PenglaiError("DSH_UNAVAILABLE", "official model route missing");
      ledger.admit(
        {
          reservationKey: `${agent.id}:${turn}:${step}`,
          estimatedTokens,
          identity: identityFor(ctx, agent, route),
          enforcePolicies: step === 1,
        },
        now(),
      );
      return route;
    },
    { global: true, prepend: true },
  );

  ctx.on("session/event", (...args: unknown[]) => {
    const session = asRecord(args[0]);
    const event = asRecord(args[1]);
    const sessionId = String(session?.id ?? "");
    const data = asRecord(event?.data);
    const turn = data?.turn;
    const step = data?.step;
    if (!sessionId || typeof turn !== "number") return;
    if (event?.type === "assistant/chunk" && typeof step === "number") {
      const chunk = asRecord(data?.chunk);
      if (chunk?.type !== "usage") return;
      const tokens = usageTokens(chunk.usage);
      if (tokens !== undefined) {
        ledger.settle(`${sessionId}:${turn}:${step}`, { tokens, priceTrusted: false }, now(), "official-token-meter:chunk");
      }
      return;
    }
    if (event?.type === "assistant/message" && typeof step === "number") {
      const tokens = usageTokens(data?.usage);
      const message = asRecord(data?.message);
      const route = asRecord(message?.source);
      if (tokens !== undefined) {
        ledger.settle(
          `${sessionId}:${turn}:${step}`,
          { tokens, priceTrusted: false },
          now(),
          "official-token-meter:final",
          route?.provider && route.model
            ? identityFor(ctx, { id: sessionId, session: {} }, { provider: String(route.provider), model: String(route.model) })
            : undefined,
        );
      }
      return;
    }
    if (event?.type === "turn/end") ledger.releaseTurn(sessionId, turn);
  });

  const reconcileClosedTurns = (agent: AgentLike) => {
    for (const value of agent.session.events ?? []) {
      const event = asRecord(value);
      const data = asRecord(event?.data);
      if (event?.type === "turn/end" && typeof data?.turn === "number") ledger.releaseTurn(agent.id, data.turn);
    }
  };
  for (const agent of ctx.agents.list()) reconcileClosedTurns(agent);
  ctx.on("agent/created", (...args: unknown[]) => {
    const agent = asRecord(args[0])?.agent as AgentLike | undefined;
    if (agent) reconcileClosedTurns(agent);
  });

  let closed = false;
  let owner: BudgetOwnerBrokerPort | undefined;
  return {
    name,
    version,
    source: "official-token-meter" as const,
    get owner() {
      return owner;
    },
    attachOwner(next: BudgetOwnerBrokerPort) {
      owner = next;
    },
    proposePolicy(input: { scope: BudgetScope; key: string; hardTokens: number | null; warnRatio?: number }) {
      if (!owner) throw new PenglaiError("DSH_UNAVAILABLE", "owner broker required");
      const objectId = budgetPolicyObjectId({ scope: input.scope, key: input.key });
      const sourceDigest = budgetSourceDigest(input);
      return owner.createProposal({
        action: BUDGET_OWNER_ACTION,
        pluginId: "@penglai/budget",
        objectId,
        sourceDigest,
      });
    },
    setPolicy(input: {
      scope: BudgetScope;
      key: string;
      hardTokens: number | null;
      warnRatio?: number;
      ownerConfirmed: boolean;
    }) {
      return ledger.setPolicy(input);
    },
    status() {
      return ledger.status(now());
    },
    assertAffordable(input: { provider: string; model: string; workspaceId?: string; estimatedTokens: number }) {
      ledger.assertWithinBudget(
        {
          estimatedTokens: input.estimatedTokens,
          identity: {
            provider: input.provider,
            model: input.model,
            ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          },
        },
        now(),
      );
    },
    reserveAuxiliary(input: {
      operationId: string;
      provider: string;
      model: string;
      workspaceId?: string;
      estimatedTokens: number;
    }) {
      ledger.admit(
        {
          reservationKey: `aux:${input.operationId}`,
          estimatedTokens: input.estimatedTokens,
          identity: {
            provider: input.provider,
            model: input.model,
            ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          },
        },
        now(),
      );
    },
    settleAuxiliary(input: { operationId: string; tokens: number }) {
      return ledger.settle(
        `aux:${input.operationId}`,
        { tokens: input.tokens, priceTrusted: false },
        now(),
        "official-token-meter:auxiliary",
      );
    },
    releaseAuxiliary(input: { operationId: string; reason: string }) {
      return ledger.releaseReservation(`aux:${input.operationId}`, input.reason);
    },
    resourceSnapshot() {
      return {
        workers: 0,
        sockets: 0,
        timers: 0,
        remotes: 0,
        db: closed ? 0 : 1,
        modelSessions: 0,
        audioHandles: 0,
      };
    },
    inspect(meter: TokenMeterFact) {
      return { tokens: meter.tokens, priceTrusted: false as const, money: null };
    },
    close() {
      if (!closed) {
        closed = true;
        ledger.close();
      }
    },
    ledger,
  };
}

export function apply(ctx: CordisContextLike) {
  const userData = requireUserData();
  if (!ctx.provide) throw new PenglaiError("DSH_UNAVAILABLE", "Cordis provide service required for budget");
  if (!ctx.effect) throw new PenglaiError("DSH_UNAVAILABLE", "Cordis effect lifecycle required for budget");
  const ledger = new BudgetLedger(join(userData, "budget", "budget.sqlite3"));
  try {
    const service = createProductionBudgetService(ctx, ledger);
    service.attachOwner(new OwnerApprovalBroker(userData, { dialog: createHostOwnerDialog(userData) }));
    ctx.provide("penglaiBudget", service);
    if (isPenglaiRemoteContext(ctx)) {
      new PenglaiBudgetRemote(ctx as Context, createBudgetSettingsApi(service, ctx));
    }
    ctx.effect(() => () => service.close());
    return service;
  } catch (error) {
    ledger.close();
    throw error;
  }
}

Object.assign(apply, { inject });
export default { name, inject, apply, version };
export * from "./service.js";
export * from "./ledger.js";
