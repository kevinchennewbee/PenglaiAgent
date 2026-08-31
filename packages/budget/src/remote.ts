import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError, PenglaiRemote } from "@penglai/contracts";
import type { BudgetPolicy, BudgetScope } from "./ledger.js";
import { consumeBudgetOwnerProof, type BudgetOwnerBrokerPort } from "./owner.js";

interface BudgetSettingsHost {
  status(): { day: string; tokens: number; reservedTokens: number; priceTrusted: false; money: null; policies: BudgetPolicy[] };
  setPolicy(input: { scope: BudgetScope; key: string; hardTokens: number | null; warnRatio?: number; ownerConfirmed: boolean }): BudgetPolicy;
  proposePolicy?(input: { scope: BudgetScope; key: string; hardTokens: number | null; warnRatio?: number }): { actionId: string };
  owner?: BudgetOwnerBrokerPort | undefined;
}

interface BudgetHostContext {
  agents?: { list(): Array<{ options?: { provider?: string; model?: string } }> };
  workspaceRegistry?: { list(): Array<{ id: string; title?: string }> };
}

export function createBudgetSettingsApi(service: BudgetSettingsHost, ctx: BudgetHostContext) {
  const options = () => {
    const routes = (ctx.agents?.list() ?? []).flatMap((agent) => {
      const provider = agent.options?.provider;
      const model = agent.options?.model;
      return provider && model ? [{ provider, model, key: `${provider}/${model}` }] : [];
    });
    const uniqueRoutes = [...new Map(routes.map((row) => [row.key, row])).values()];
    return {
      workspaces: (ctx.workspaceRegistry?.list() ?? []).map((row) => ({ id: row.id, title: row.title ?? row.id })),
      providers: [...new Set(uniqueRoutes.map((row) => row.provider))],
      models: uniqueRoutes,
    };
  };
  const liveKey = (scope: BudgetScope, key: string) => {
    const available = options();
    const resolved = scope === "global" ? "*" : key;
    if (scope === "workspace" && !available.workspaces.some((row) => row.id === resolved)) {
      throw new PenglaiError("INVALID_INPUT", "budget Workspace is not live");
    }
    if (scope === "provider" && !available.providers.includes(resolved)) {
      throw new PenglaiError("INVALID_INPUT", "budget provider is not live");
    }
    if (scope === "model" && !available.models.some((row) => row.key === resolved)) {
      throw new PenglaiError("INVALID_INPUT", "budget model route is not live");
    }
    return resolved;
  };
  return {
    status() { return { ...service.status(), options: options() }; },
    proposePolicy(input: { scope: BudgetScope; key: string; hardTokens: number | null; warnRatio?: number }) {
      if (!(["global", "workspace", "provider", "model"] as string[]).includes(input.scope)) {
        throw new PenglaiError("INVALID_INPUT", "invalid budget scope");
      }
      if (!service.proposePolicy) throw new PenglaiError("DSH_UNAVAILABLE", "budget owner broker unavailable");
      const key = liveKey(input.scope, input.key);
      return service.proposePolicy({ ...input, key });
    },
    setPolicy(input: { scope: BudgetScope; key: string; hardTokens: number | null; warnRatio?: number; ownerConfirmed: boolean; actionId?: string; receipt?: string }) {
      if (!(["global", "workspace", "provider", "model"] as string[]).includes(input.scope)) {
        throw new PenglaiError("INVALID_INPUT", "invalid budget scope");
      }
      const key = liveKey(input.scope, input.key);
      if (!input.actionId || !input.receipt) {
        throw new PenglaiError("SECURITY_POLICY", "budget change requires Owner confirmation");
      }
      const complete = consumeBudgetOwnerProof(service.owner, {
        actionId: input.actionId,
        receipt: input.receipt,
        scope: input.scope,
        key,
        hardTokens: input.hardTokens,
        ...(input.warnRatio !== undefined ? { warnRatio: input.warnRatio } : {}),
      });
      const policy = service.setPolicy({ ...input, key, ownerConfirmed: true });
      complete();
      return policy;
    },
  };
}

export class PenglaiBudgetRemote extends TypertRemoteService {
  constructor(ctx: Context, private readonly api: ReturnType<typeof createBudgetSettingsApi>) { super(ctx, "penglaiBudgetSettings"); }
  @PenglaiRemote status() { return this.api.status(); }
  @PenglaiRemote proposePolicy(input: { scope: BudgetScope; key: string; hardTokens: number | null; warnRatio?: number }) { return this.api.proposePolicy(input); }
  @PenglaiRemote setPolicy(input: { scope: BudgetScope; key: string; hardTokens: number | null; warnRatio?: number; ownerConfirmed: boolean; actionId?: string; receipt?: string }) { return this.api.setPolicy(input); }
}

export const TYPERT_REMOTE = { package: "@penglai/budget", descriptors: ["status", "proposePolicy", "setPolicy"] };
