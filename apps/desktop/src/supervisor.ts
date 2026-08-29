import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  EmbeddedDshSupervisor,
  resolveRuntimeLayout,
  type InventoryProof,
  type RuntimeLayout,
  type UserLayout,
} from "@penglai/runtime";

export type SupervisorState = "stopped" | "starting" | "healthy" | "degraded" | "crashed" | "stopping";

export interface DshSupervisorInner {
  state: SupervisorState;
  port: number;
  restarts: number;
  health: { http: number; inventory: InventoryProof } | undefined;
  child?: { pid?: number | undefined } | undefined;
  start(user: UserLayout, env?: NodeJS.ProcessEnv): Promise<{ port: number }>;
  stop(): Promise<void>;
}

export type DshSupervisorFactory = (layout: RuntimeLayout) => DshSupervisorInner;

export class DshSupervisor {
  private inner: DshSupervisorInner | undefined;

  get state(): SupervisorState {
    return this.inner?.state ?? "stopped";
  }

  get port(): number {
    return this.inner?.port ?? 0;
  }

  get restarts(): number {
    return this.inner?.restarts ?? 0;
  }

  get health(): { http: number; inventory: InventoryProof } | undefined {
    return this.inner?.health;
  }

  get childPid(): number | undefined {
    return this.inner?.child?.pid;
  }

  constructor(
    private layout?: RuntimeLayout,
    private readonly factory: DshSupervisorFactory = (runtimeLayout) => new EmbeddedDshSupervisor(runtimeLayout),
  ) {}

  attach(layout: RuntimeLayout): void {
    if (this.inner && this.inner.state !== "stopped") {
      throw new Error("cannot replace embedded runtime layout while DSH is running");
    }
    this.layout = layout;
    this.inner = undefined;
  }

  async start(user: UserLayout): Promise<{ port: number }> {
    if (!this.layout) throw new Error("embedded runtime layout required");
    this.inner ??= this.factory(this.layout);
    const extra: NodeJS.ProcessEnv = {};
    if (process.env.PENGLAI_PLUGINS_DIR) extra.PENGLAI_PLUGINS_DIR = process.env.PENGLAI_PLUGINS_DIR;
    if (process.env.PENGLAI_APP_ROOT) extra.PENGLAI_APP_ROOT = process.env.PENGLAI_APP_ROOT;
    if (process.env.PENGLAI_MNEMON_BINARY) extra.PENGLAI_MNEMON_BINARY = process.env.PENGLAI_MNEMON_BINARY;
    return this.inner.start(user, extra);
  }

  async stop(): Promise<void> {
    await this.inner?.stop();
  }
}

export function layoutFromResources(resources: string): RuntimeLayout {
  const layout = resolveRuntimeLayout(resources);
  if (!existsSync(layout.nodeBin) || !existsSync(layout.dshEntry)) {
    throw new Error("embedded Node/DSH missing; refusing PATH fallback");
  }
  return layout;
}

/**
 * True when `candidate` is the embedded Node binary inside the app's own
 * `runtime/` tree. Separator-agnostic so it holds on both POSIX
 * (`<appRoot>/runtime/node/bin/node`) and Windows
 * (`<appRoot>\runtime\node\node.exe`) layouts; the previous
 * `nodeBin.includes("/runtime/")` check never matched a Windows backslash path.
 */
export function isOwnedRuntimePath(appRoot: string, candidate: string): boolean {
  const root = appRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const cand = candidate.replace(/\\/g, "/");
  if (cand === root || !cand.startsWith(`${root}/`)) return false;
  return cand.slice(root.length + 1).split("/")[0] === "runtime";
}

export function findResourcesRoot(opts: { envRoot?: string; resourcesPath?: string; moduleDir: string }): string {
  const candidates: string[] = [];
  if (opts.envRoot) candidates.push(opts.envRoot);
  if (opts.resourcesPath) candidates.push(opts.resourcesPath);
  candidates.push(join(opts.moduleDir, ".."));
  candidates.push(join(opts.moduleDir, "..", "..", "..", "dist", "runtime-staging"));
  const tried: string[] = [];
  for (const raw of candidates) {
    const root = resolve(raw);
    tried.push(root);
    try {
      layoutFromResources(root);
      return root;
    } catch {
      /* keep looking */
    }
  }
  throw new Error(`embedded Node/DSH missing; refusing PATH fallback (tried ${tried.join(", ")})`);
}
