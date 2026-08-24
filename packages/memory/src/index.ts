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
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import { PenglaiError, RELEASE } from "@penglai/contracts";
import { applyEmbeddedMemorySources, createContextSettingsApi } from "@penglai/memory-sources";
import { assertReadable, createMemoryService, modelCannotWriteGlobal, type MemoryWrite } from "./service.js";
import { MemoryStore } from "./store.js";
import { createMemorySettingsApi, PenglaiMemoryRemote } from "./remote.js";
import { MnemonMemoryService } from "./engine/service.js";
import { discoverLegacy, importLegacy } from "./migration/legacy-053.js";
import { registerMemoryTools } from "./tools.js";
import { MemoryV2Store } from "./v2/candidates.js";
import { ingestCuratorOutput } from "./v2/curator.js";
import { migrateJournalToV2 } from "./v2/migrate.js";
import { MEMORY_OWNER_ACTIONS } from "./v2/owner.js";
import { consumeMemoryOwnerProof, proposeMemoryAction, type MemoryOwnerBrokerPort } from "./v2/owner-adapter.js";
import { ingestOfficialTurn, runHostCurator, sessionEventParts, turnSummary, withMemoryRecall, workspaceIdForSession } from "./turn-pipeline.js";
import { OwnerApprovalBroker, createHostOwnerDialog } from "@penglai/runtime";

export const name = "@penglai/memory";
export const inject = ["skills", "workspaceRegistry", "tools"];
export const version = RELEASE;
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface OfficialSkillSummary {
  name: string;
}

interface CordisContextLike {
  skills?: {
    snapshot(options?: { cwd?: string }): Promise<{ skills: OfficialSkillSummary[]; complete: boolean }>;
  };
  workspaceRegistry?: { list(): Array<{ id: string; title?: string; sessionIds?: readonly string[] }> };
  provide?: (name: string, service: unknown) => unknown;
  effect?: (setup: () => () => void) => unknown;
  on?: (event: string, listener: (...args: unknown[]) => unknown, options?: Record<string, unknown>) => unknown;
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
  onClose?: () => void;
  owner?: MemoryOwnerBrokerPort;
  curator?: (summary: string) => Promise<string>;
}) {
  const v2 = new MemoryV2Store(join(opts.userData, "memory", "v2.sqlite3"));
  const engine = new MnemonMemoryService(opts.userData, {
    ...(process.env.PENGLAI_MNEMON_BINARY ? { binaryPath: process.env.PENGLAI_MNEMON_BINARY } : {}),
    ...(process.env.PENGLAI_APP_ROOT ? { appRoot: process.env.PENGLAI_APP_ROOT } : {}),
    packageRoot: PACKAGE_ROOT,
  });
  const skillsRoot = officialSkillsRoot(opts.userData);
  migrateJournalToV2(engine.journal, v2, { userData: opts.userData });
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
    async correct(oldId: string, text: string, workspaceId?: string, proof?: { actionId: string; receipt: string }) {
      if (!proof?.actionId || !proof.receipt) {
        throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      }
      const digest = createHash("sha256").update(`correct:${oldId}:${text}`).digest("hex");
      consumeMemoryOwnerProof(opts.owner, {
        action: MEMORY_OWNER_ACTIONS.correct,
        actionId: proof.actionId,
        receipt: proof.receipt,
        objectId: oldId,
        ...(workspaceId ? { workspaceId } : {}),
        resultDigest: digest,
      });
      return engine.correct(oldId, text, workspaceId);
    },
    async forget(id: string, workspaceId?: string, proof?: { actionId: string; receipt: string }) {
      if (!proof?.actionId || !proof.receipt) {
        throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      }
      const digest = createHash("sha256").update(`forget:${id}`).digest("hex");
      consumeMemoryOwnerProof(opts.owner, {
        action: MEMORY_OWNER_ACTIONS.forget,
        actionId: proof.actionId,
        receipt: proof.receipt,
        objectId: id,
        ...(workspaceId ? { workspaceId } : {}),
        resultDigest: digest,
      });
      const prior = engine.journal.get(id);
      const result = await engine.forget(id, workspaceId);
      if (prior) v2.recordTombstone(id, prior.contentDigest);
      return result;
    },
    proposeAction(input: { action: string; objectId: string; workspaceId?: string; sessionId?: string }) {
      if (!opts.owner) throw new PenglaiError("DSH_UNAVAILABLE", "owner broker required");
      const action = input.action as (typeof MEMORY_OWNER_ACTIONS)[keyof typeof MEMORY_OWNER_ACTIONS];
      if (!Object.values(MEMORY_OWNER_ACTIONS).includes(action)) {
        throw new PenglaiError("SECURITY_POLICY", "MEMORY_OWNER_ACTION");
      }
      const sourceDigest = createHash("sha256").update(`${action}:${input.objectId}`).digest("hex");
      return proposeMemoryAction(opts.owner, {
        action,
        objectId: input.objectId,
        sourceDigest,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      });
    },
    acceptCandidate(input: { candidateId: string; actionId: string; receipt: string; personal?: boolean }) {
      if (!input.receipt) throw new PenglaiError("SECURITY_POLICY", "memory broker receipt required");
      const hit = v2.getCandidate(input.candidateId);
      const digest = createHash("sha256").update(input.candidateId).digest("hex");
      consumeMemoryOwnerProof(opts.owner, {
        action: input.personal ? MEMORY_OWNER_ACTIONS.personal : MEMORY_OWNER_ACTIONS.accept,
        actionId: input.actionId,
        receipt: input.receipt,
        objectId: input.candidateId,
        ...(hit?.workspaceId ? { workspaceId: hit.workspaceId } : {}),
        resultDigest: digest,
      });
      return v2.decide(input.candidateId, "accepted", {
        actionId: input.actionId,
        ...(input.personal ? { personal: true } : {}),
      });
    },
    rejectCandidate(input: { candidateId: string }) {
      return v2.decide(input.candidateId, "rejected");
    },
    setMemoryMode(mode: string) {
      return v2.setMode(mode);
    },
    ingestCurator(
      raw: string,
      ctx: { workspaceId: string; sessionId: string; turnId: string; sourceDigest: string },
    ) {
      try {
        return ingestCuratorOutput(v2, raw, ctx);
      } catch {
        return { failOpen: true, enqueued: 0, skipped: 0, code: "CURATOR_SCHEMA_INVALID" as const };
      }
    },
    async runCurator(summary: string) {
      if (!opts.curator) return JSON.stringify({ candidates: [] });
      try {
        return await opts.curator(summary);
      } catch {
        return "not-json";
      }
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
    list(scope?: string, workspaceId?: string) {
      if (scope === "candidate") {
        return v2.listCandidates(workspaceId ?? "").map((row) => ({
          id: row.candidateId,
          text: row.text,
          workspaceId: row.workspaceId,
        }));
      }
      return engine
        .listConfirmed({
          scope: scope === "workspace" ? "workspace" : "personal",
          ...(workspaceId ? { workspaceId } : {}),
        })
        .map((row) => ({ id: row.id, text: row.content, workspaceId: row.workspaceId }));
    },
    count(workspaceId?: string) {
      const confirmed = engine.countConfirmed(workspaceId ? { workspaceId } : {});
      return {
        ...confirmed,
        pending: workspaceId ? v2.listCandidates(workspaceId).length : 0,
        mode: v2.mode(),
      };
    },
    memoryV2: v2,
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
      try {
        engine.close();
        v2.close();
      } finally {
        opts.onClose?.();
      }
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
  const sources = applyEmbeddedMemorySources(ctx);
  const owner = new OwnerApprovalBroker(userData, { dialog: createHostOwnerDialog(userData) });
  let service: ReturnType<typeof createDurableMemoryService> | undefined;
  try {
    service = createDurableMemoryService({
      userData,
      skills: ctx.skills,
      owner,
      curator: async (summary) => {
        const create = (ctx as { agents?: { create?: (opts: unknown) => Promise<unknown> } }).agents?.create;
        if (typeof create !== "function") return JSON.stringify({ candidates: [] });
        return runHostCurator({
          summary,
          generate: async (prompt) => {
            let handle: {
              agent?: { generate?: (opts: { prompt: string }) => Promise<{ text?: string } | string> };
              dispose?: () => Promise<void>;
            } | undefined;
            try {
              handle = (await create({
                setup: (agentCtx: { tools?: { guard?: (fn: () => string) => unknown } }) => {
                  agentCtx.tools?.guard?.(() => "penglai-memory-curator/no-tools");
                },
              })) as typeof handle;
              const result = await handle?.agent?.generate?.({ prompt });
              if (typeof result === "string") return result;
              if (result && typeof result === "object" && typeof result.text === "string") return result.text;
              return JSON.stringify({ candidates: [] });
            } finally {
              await handle?.dispose?.().catch(() => undefined);
            }
          },
        });
      },
      onClose: () => sources.close(),
    });
    const activeService = service;
    const turns = new Map<string, { user?: string; assistant?: string }>();
    ctx.on?.("session/event", (...args: unknown[]) => {
      const parts = sessionEventParts(args);
      if (!parts.sessionId || typeof parts.turn !== "number") return;
      const key = `${parts.sessionId}:${parts.turn}`;
      const prev = turns.get(key) ?? {};
      if (parts.type === "user/message" && parts.text) prev.user = parts.text;
      if (parts.type === "assistant/message" && parts.text) prev.assistant = parts.text;
      turns.set(key, prev);
      if (parts.type !== "turn/end") return;
      const workspaceId = workspaceIdForSession(workspaceRegistry.list(), parts.sessionId);
      if (!workspaceId || activeService.memoryV2.mode() === "off") {
        turns.delete(key);
        return;
      }
      const summary = turnSummary(prev);
      turns.delete(key);
      void Promise.resolve()
        .then(async () => {
          const raw = await activeService.runCurator(summary);
          ingestOfficialTurn({
            store: activeService.memoryV2,
            workspaceId,
            sessionId: parts.sessionId!,
            turnId: String(parts.turn),
            raw,
            summary,
          });
        })
        .catch(() => undefined);
    });
    ctx.on?.(
      "agent/pre-step",
      async (payload: unknown, next: unknown) => {
        const decision = typeof next === "function" ? await (next as () => unknown)() : next;
        const row = decision && typeof decision === "object" ? (decision as { kind?: string; messages?: Array<{ content?: unknown[] }> }) : undefined;
        if (row?.kind !== "enter" || !Array.isArray(row.messages)) return decision;
        const sessionId = String((payload as { agent?: { id?: string } } | undefined)?.agent?.id ?? "");
        const workspaceId = workspaceIdForSession(workspaceRegistry.list(), sessionId);
        if (!workspaceId || activeService.memoryV2.mode() === "off") return decision;
        const confirmed = activeService.engine
          .listConfirmed({ scope: "workspace", workspaceId })
          .map((item) => ({
            id: item.id,
            scope: "workspace" as const,
            text: item.content,
            sourceDigest: item.contentDigest ?? "a".repeat(64),
          }));
        const recall = activeService.memoryV2.recallSet({ workspaceId, confirmed });
        return { ...row, messages: withMemoryRecall(row.messages, recall), penglaiMemoryUsed: recall.used };
      },
      { global: true, prepend: true },
    );
    registerMemoryTools(ctx, activeService.engine);
    ctx.provide("penglaiMemory", activeService);
    if (ctx instanceof Context) {
      const sourcesApi = createContextSettingsApi(sources, userData, workspaceRegistry);
      new PenglaiMemoryRemote(ctx, createMemorySettingsApi(activeService, workspaceRegistry, sourcesApi));
    }
    ctx.effect?.(() => () => activeService.close?.());
  } catch (error) {
    if (service) service.close();
    else sources.close();
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
export { MemoryV2Store } from "./v2/candidates.js";
export { ingestCuratorOutput } from "./v2/curator.js";
export { migrateJournalToV2 } from "./v2/migrate.js";
export type { MemoryWrite };
export { modelCannotWriteGlobal, assertReadable };
export type { MemoryWrite as WriteInput };
