import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { PenglaiError, RELEASE } from "@penglai/contracts";
import { assertReadable, createMemoryService, modelCannotWriteGlobal, type MemoryWrite } from "./service.js";
import { MemoryStore } from "./store.js";
import { createMemorySettingsApi, PenglaiMemoryRemote } from "./remote.js";
import { MnemonMemoryService } from "./engine/service.js";
import { discoverLegacy, importLegacy } from "./migration/legacy-053.js";
import { registerMemoryTools } from "./tools.js";

export const name = "@penglai/memory";
export const inject = ["skills", "workspaceRegistry", "tools"];
export const version = RELEASE;

interface OfficialSkillSummary {
  name: string;
}

interface CordisContextLike {
  skills?: {
    snapshot(options?: { cwd?: string }): Promise<{ skills: OfficialSkillSummary[]; complete: boolean }>;
  };
  workspaceRegistry?: { list(): Array<{ id: string; title?: string }> };
  provide?: (name: string, service: unknown) => unknown;
  effect?: (setup: () => () => void) => unknown;
}

export interface SopPromotion {
  name: string;
  description: string;
  body: string;
  visibleDiff: string;
  ownerConfirmed: boolean;
}

export interface SopReceipt {
  registry: "official-dsh-skills";
  name: string;
  sha256: string;
  observed: true;
}

function requireUserData(): string {
  const root = process.env.PENGLAI_USER_DATA;
  if (!root) throw new PenglaiError("DSH_UNAVAILABLE", "PENGLAI_USER_DATA required for @penglai/memory");
  return resolve(root);
}

function officialSkillsRoot(userData: string): string {
  const dshHome = resolve(process.env.DSH_HOME ?? join(userData, "dsh-home"));
  const rel = relative(userData, dshHome);
  if (!isAbsolute(dshHome) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new PenglaiError("SECURITY_POLICY", "official DSH_HOME must stay under Penglai userData");
  }
  return join(dshHome, "skills");
}

function assertNoSymlink(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new PenglaiError("SECURITY_POLICY", "official skill path must not be a symlink");
  }
}

function skillMarkdown(input: SopPromotion): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.name)) {
    throw new PenglaiError("INVALID_INPUT", "official skill name must be kebab-case");
  }
  if (!input.ownerConfirmed || !input.visibleDiff.trim()) {
    throw new PenglaiError("SECURITY_POLICY", "SOP promotion requires visible diff and Owner confirm");
  }
  if (!input.description.trim() || !input.body.trim()) {
    throw new PenglaiError("INVALID_INPUT", "SOP description and body required");
  }
  if (/api[_-]?key|app[_-]?secret|private[_-]?key|password\s*[:=]/i.test(input.body)) {
    throw new PenglaiError("SECURITY_POLICY", "SOP content looks secret-bearing");
  }
  const description = input.description.replace(/[\r\n]+/g, " ").trim();
  return `---\nname: ${input.name}\ndescription: ${JSON.stringify(description)}\ndisable-model-invocation: false\nuser-invocable: true\n---\n\n${input.body.trim()}\n`;
}

async function waitForOfficialSkill(
  skills: NonNullable<CordisContextLike["skills"]>,
  name: string,
  cwd: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = await skills.snapshot({ cwd });
    if (snapshot.complete && snapshot.skills.some((skill) => skill.name === name)) return;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new PenglaiError("DSH_UNAVAILABLE", "official Skills registry did not observe promoted SOP");
}

export function createDurableMemoryService(opts: {
  userData: string;
  skills: NonNullable<CordisContextLike["skills"]>;
}) {
  const engine = new MnemonMemoryService(opts.userData, {
    ...(process.env.PENGLAI_MNEMON_BINARY ? { binaryPath: process.env.PENGLAI_MNEMON_BINARY } : {}),
    ...(process.env.PENGLAI_APP_ROOT ? { appRoot: process.env.PENGLAI_APP_ROOT } : {}),
  });
  const skillsRoot = officialSkillsRoot(opts.userData);
  let closed = false;
  return {
    engine,
    async remember(input: { text: string; workspaceId?: string }) {
      return engine.remember(input);
    },
    async search(query: string, workspaceId?: string) {
      return engine.search(query, workspaceId);
    },
    async recall(query: string, workspaceId?: string) {
      return engine.recall(query, workspaceId);
    },
    async related(id: string, workspaceId?: string) {
      return engine.related(id, workspaceId);
    },
    async why(id: string, workspaceId?: string) {
      return engine.why(id, workspaceId);
    },
    async correct(oldId: string, text: string, workspaceId?: string) {
      return engine.correct(oldId, text, workspaceId);
    },
    async forget(id: string, workspaceId?: string) {
      return engine.forget(id, workspaceId);
    },
    async deleteKnown(workspaceId?: string) {
      return engine.deleteScope(workspaceId);
    },
    async graph(workspaceId?: string, includePersonal = false) {
      return engine.graph(workspaceId, includePersonal);
    },
    write(input: MemoryWrite) {
      throw new PenglaiError("SECURITY_POLICY", "runtime memory writes go through remember()");
    },
    list() {
      throw new PenglaiError("SECURITY_POLICY", "runtime memory lists go through search()");
    },
    deleteScope() {
      throw new PenglaiError("SECURITY_POLICY", "runtime memory delete goes through forget()");
    },
    async promoteSop(input: SopPromotion): Promise<SopReceipt> {
      const markdown = skillMarkdown(input);
      mkdirSync(skillsRoot, { recursive: true, mode: 0o700 });
      assertNoSymlink(skillsRoot);
      const canonicalRoot = realpathSync(skillsRoot);
      const skillDir = join(canonicalRoot, input.name);
      assertNoSymlink(skillDir);
      mkdirSync(skillDir, { recursive: true, mode: 0o700 });
      assertNoSymlink(skillDir);
      const canonicalDir = realpathSync(skillDir);
      if (relative(canonicalRoot, canonicalDir).startsWith("..")) {
        throw new PenglaiError("SECURITY_POLICY", "official skill path escaped root");
      }
      const target = join(canonicalDir, "SKILL.md");
      assertNoSymlink(target);
      const temp = join(canonicalDir, `.SKILL.${process.pid}.${randomUUID()}.tmp`);
      writeFileSync(temp, markdown, { encoding: "utf8", mode: 0o600, flag: "wx" });
      renameSync(temp, target);
      await waitForOfficialSkill(opts.skills, input.name, opts.userData);
      const sha256 = createHash("sha256").update(readFileSync(target)).digest("hex");
      return { registry: "official-dsh-skills", name: input.name, sha256, observed: true };
    },
    async rememberExplicit(input: { text: string; workspaceId?: string }) {
      const row = await engine.remember(input);
      return { ok: true as const, id: row.id };
    },
    async importPreview() {
      return discoverLegacy(opts.userData);
    },
    async importConfirm() {
      return importLegacy(opts.userData, engine);
    },
    close() {
      if (closed) return;
      closed = true;
      engine.close();
    },
    resourceSnapshot() {
      return {
        workers: 0,
        sockets: 0,
        timers: 0,
        remotes: 0,
        db: closed ? 0 : engine.resourceSnapshot().db,
        modelSessions: 0,
        audioHandles: 0,
      };
    },
  };
}

export function apply(ctx: CordisContextLike) {
  const userData = requireUserData();
  if (!ctx.skills?.snapshot) throw new PenglaiError("DSH_UNAVAILABLE", "official DSH Skills registry required for memory");
  if (!ctx.provide) throw new PenglaiError("DSH_UNAVAILABLE", "Cordis provide service required for memory");
  const workspaceRegistry = ctx.workspaceRegistry;
  if (!workspaceRegistry?.list) throw new PenglaiError("DSH_UNAVAILABLE", "official Workspace registry required for memory");
  const service = createDurableMemoryService({ userData, skills: ctx.skills });
  try {
    registerMemoryTools(ctx, service.engine);
    ctx.provide("penglaiMemory", service);
    if (ctx instanceof Context) new PenglaiMemoryRemote(ctx, createMemorySettingsApi(service, workspaceRegistry));
    ctx.effect?.(() => () => service.close?.());
  } catch (error) {
    service.close();
    throw error;
  }
  return service;
}

Object.assign(apply, { inject });
export default { name, inject, apply, version };
export * from "./service.js";
export * from "./store.js";
export { MnemonMemoryService, IsolatedMemoryEngine } from "./engine/service.js";
export { bundledMnemonBinary, MNEMON_ASSETS } from "./engine/mnemon-provider.js";
export { importLegacy, previewLegacy } from "./migration/legacy-053.js";
export { projectGraph } from "./graph/projection.js";
export type { MemoryWrite };
export { modelCannotWriteGlobal, assertReadable };
export type { MemoryWrite as WriteInput };
