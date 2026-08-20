/** Official DSH opener from `@deepseek-ai/dsh-system-prompt` when `includeHarnessIdentity` is true. */
export const HARNESS_IDENTITY_NAME = "harness:identity";
export const PERSONA_SECTION_NAME = "deployment:persona";
export const PENGLAI_IDENTITY_NAME = "penglai:identity";

/**
 * Deployment identity contributed through the official system-prompt assemble
 * waterfall. This is not a second Agent runtime or a complete-prompt takeover.
 */
export const PENGLAI_PRODUCT_IDENTITY = [
  "You are 蓬莱 Penglai, the user's local desktop assistant.",
  "When asked who you are, introduce yourself as 蓬莱 or Penglai.",
  "Do not introduce yourself as DeepSeek Harness or DSH, and do not mention those names unless the user explicitly asks.",
  "Reply in the user's language.",
].join("\n");

export interface PromptSectionLike {
  name: string;
  text?: string;
  order?: number;
  complete?: boolean;
}

export interface PromptAssemblyLike {
  sections?: PromptSectionLike[];
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function fillOfficialPromptVariables(
  assembly: Record<string, unknown>,
  context: unknown,
): Record<string, string | undefined> {
  const current = record(assembly.variables) ?? {};
  const variables: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(current)) {
    variables[key] = typeof value === "string" ? value : undefined;
  }
  const agent = record(record(context)?.agent);
  const options = record(agent?.agentOptions) ?? record(agent?.options);
  const meta = record(agent?.meta);
  if (!variables.model) {
    variables.model =
      textFrom(options?.model) ?? textFrom(agent?.model) ?? textFrom(record(agent?.session)?.model);
  }
  if (!variables.cwd) {
    variables.cwd = textFrom(meta?.cwd) ?? textFrom(agent?.cwd);
  }
  return variables;
}

function neutralizeUnresolvedPersonaPlaceholders(
  text: string,
  variables: Record<string, string | undefined>,
): string {
  return text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (full, name: string) => {
    const value = variables[name];
    return typeof value === "string" && value.length > 0 ? full : "";
  });
}

export function applyPenglaiProductIdentity(assembly: unknown, context?: unknown): unknown {
  if (!isRecord(assembly) || !Array.isArray(assembly.sections)) return assembly;
  const variables = fillOfficialPromptVariables(assembly, context);
  const sections = assembly.sections.map((section) => {
    if (!isRecord(section)) return section;
    const next = { ...section } as unknown as PromptSectionLike;
    if (
      (next.name === PERSONA_SECTION_NAME || next.name === PENGLAI_IDENTITY_NAME) &&
      typeof next.text === "string"
    ) {
      next.text = neutralizeUnresolvedPersonaPlaceholders(next.text, variables);
    }
    return next;
  }) as PromptSectionLike[];
  const withVars = { ...assembly, sections, variables };
  const harness = sections.find((section) => section.name === HARNESS_IDENTITY_NAME);
  if (harness) {
    harness.text = PENGLAI_PRODUCT_IDENTITY;
    return withVars;
  }
  if (sections.some((section) => section.name === PENGLAI_IDENTITY_NAME)) {
    return withVars;
  }
  return {
    ...withVars,
    sections: [{ name: PENGLAI_IDENTITY_NAME, text: PENGLAI_PRODUCT_IDENTITY }, ...sections],
  };
}

export function installPenglaiProductIdentity(ctx: {
  on?: (...args: unknown[]) => unknown;
  effect?: (setup: () => () => void) => unknown;
}): void {
  if (typeof ctx.on !== "function") return;
  const dispose = ctx.on(
    "system-prompt/assemble",
    async (assembly: unknown, _context: unknown, next: unknown) => {
      const base = typeof next === "function" ? await (next as () => Promise<unknown>)() : assembly;
      return applyPenglaiProductIdentity(base, _context);
    },
  );
  if (typeof dispose === "function") {
    ctx.effect?.(() => () => {
      dispose();
    });
  }
}
