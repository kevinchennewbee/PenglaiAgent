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

export class DshSupervisor {
  private inner: EmbeddedDshSupervisor | undefined;
  state: SupervisorState = "stopped";
  port = 0;
  restarts = 0;
  health: { http: number; inventory: InventoryProof } | undefined;

  get childPid(): number | undefined {
    return this.inner?.child?.pid;
  }

  constructor(private layout?: RuntimeLayout) {}

  attach(layout: RuntimeLayout): void {
    this.layout = layout;
  }

  async start(user: UserLayout): Promise<{ port: number }> {
    if (!this.layout) throw new Error("embedded runtime layout required");
    this.inner = new EmbeddedDshSupervisor(this.layout);
    const extra: NodeJS.ProcessEnv = {};
    if (process.env.PENGLAI_PLUGINS_DIR) extra.PENGLAI_PLUGINS_DIR = process.env.PENGLAI_PLUGINS_DIR;
    const out = await this.inner.start(user, extra);
    this.port = out.port;
    this.state = this.inner.state === "healthy" ? "healthy" : "crashed";
    this.restarts = this.inner.restarts;
    this.health = this.inner.health;
    return out;
  }

  async stop(): Promise<void> {
    await this.inner?.stop();
    this.state = "stopped";
    this.health = undefined;
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
