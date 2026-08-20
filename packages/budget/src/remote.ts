import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError } from "@penglai/contracts";
import type { BudgetPolicy, BudgetScope } from "./ledger.js";

interface BudgetSettingsHost {
  status(): { day: string; tokens: number; reservedTokens: number; priceTrusted: false; money: null; policies: BudgetPolicy[] };
  setPolicy(input: { scope: BudgetScope; key: string; hardTokens: number | null; warnRatio?: number; ownerConfirmed: boolean }): BudgetPolicy;
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
  return {
    status() { return { ...service.status(), options: options() }; },
    setPolicy(input: { scope: BudgetScope; key: string; hardTokens: number | null; warnRatio?: number; ownerConfirmed: boolean }) {
      if (!(["global", "workspace", "provider", "model"] as string[]).includes(input.scope)) {
        throw new PenglaiError("INVALID_INPUT", "invalid budget scope");
      }
      const available = options();
      const key = input.scope === "global" ? "*" : input.key;
      if (input.scope === "workspace" && !available.workspaces.some((row) => row.id === key)) throw new PenglaiError("INVALID_INPUT", "budget Workspace is not live");
      if (input.scope === "provider" && !available.providers.includes(key)) throw new PenglaiError("INVALID_INPUT", "budget provider is not live");
      if (input.scope === "model" && !available.models.some((row) => row.key === key)) throw new PenglaiError("INVALID_INPUT", "budget model route is not live");
      return service.setPolicy({ ...input, key });
    },
  };
}

export class PenglaiBudgetRemote extends TypertRemoteService {
  constructor(ctx: Context, private readonly api: ReturnType<typeof createBudgetSettingsApi>) { super(ctx, "penglaiBudgetSettings"); }
  @Remote status() { return this.api.status(); }
  @Remote setPolicy(input: { scope: BudgetScope; key: string; hardTokens: number | null; warnRatio?: number; ownerConfirmed: boolean }) { return this.api.setPolicy(input); }
}

export const TYPERT_REMOTE = { package: "@penglai/budget", descriptors: ["status", "setPolicy"] };
