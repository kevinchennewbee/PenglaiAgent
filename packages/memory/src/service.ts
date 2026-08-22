import { PenglaiError } from "@penglai/contracts";
import type { MemoryStore } from "./store.js";

export type MemoryScope = "global" | "workspace" | "candidate";

export interface MemoryWrite {
  scope: MemoryScope;
  workspaceId?: string;
  text: string;
  ownerConfirmed?: boolean;
  visibleDiff?: string;
  officialSkill?: boolean;
}

export const GLOBAL_L1_MAX_ROWS = 30;
export const GLOBAL_L1_MAX_BYTES = 8 * 1024;

export function assertReadable(scope: MemoryScope, sessionWorkspaceId?: string, itemWorkspaceId?: string): void {
  if (scope === "global") return;
  if (scope === "workspace" && sessionWorkspaceId && itemWorkspaceId && sessionWorkspaceId !== itemWorkspaceId) {
    throw new PenglaiError("SECURITY_POLICY", "memory workspace scope isolation");
  }
}

export function writeMemory(store: { global: string[] }, input: MemoryWrite): { ok: true; viaOfficialSkill?: boolean } {
  if (input.scope === "global" || input.officialSkill) {
    if (!input.ownerConfirmed || !input.visibleDiff) {
      throw new PenglaiError("SECURITY_POLICY", "global/SOP write requires visible diff and Owner confirm");
    }
    if (input.scope === "global" && store.global.length >= GLOBAL_L1_MAX_ROWS) {
      throw new PenglaiError("INVALID_INPUT", "global L1 row budget");
    }
    if (input.scope === "global") store.global.push(input.text);
    return { ok: true, viaOfficialSkill: Boolean(input.officialSkill) };
  }
  if (input.scope === "workspace" && !input.workspaceId) {
    throw new PenglaiError("INVALID_INPUT", "workspace memory needs workspaceId");
  }
  return { ok: true };
}

export function modelCannotWriteGlobal(): never {
  throw new PenglaiError("SECURITY_POLICY", "model cannot write global memory");
}

export interface MemoryService {
  name: string;
  version: string;
  assertReadable: typeof assertReadable;
  modelCannotWriteGlobal: typeof modelCannotWriteGlobal;
  write: (input: MemoryWrite, receipt?: string) => { ok: true; id?: number; viaOfficialSkill?: boolean };
  list: (scope: MemoryScope, workspaceId?: string) => Array<{ id: number; text: string; workspaceId?: string | null }>;
  readForSession: (
    workspaceId: string | undefined,
  ) => { global: Array<{ id: number; text: string }>; workspace: Array<{ id: number; text: string }> };
  deleteScope: (scope: MemoryScope, workspaceId?: string) => number;
  close?: () => void;
}

export function createMemoryService(store?: MemoryStore): MemoryService {
  if (!store) {
    const mem = { global: [] as string[] };
    let seq = 0;
    const rows = new Map<number, MemoryWrite & { id: number }>();
    return {
      name: "@penglai/memory",
      version: "0.5.3",
      assertReadable,
      modelCannotWriteGlobal,
      write(input) {
        const checked = writeMemory(mem, input);
        if (
          input.scope === "global" &&
          mem.global.reduce((total, text) => total + Buffer.byteLength(text, "utf8"), 0) > GLOBAL_L1_MAX_BYTES
        ) {
          mem.global.pop();
          throw new PenglaiError("INVALID_INPUT", "global L1 byte budget");
        }
        seq += 1;
        rows.set(seq, { ...input, id: seq });
        return { ...checked, id: seq };
      },
      list(scope, workspaceId) {
        if (scope === "workspace") {
          if (!workspaceId) throw new PenglaiError("INVALID_INPUT", "workspace memory needs workspaceId");
        }
        return [...rows.values()]
          .filter((r) => r.scope === scope && (scope !== "workspace" || r.workspaceId === workspaceId))
          .map((r) => ({ id: r.id, text: r.text, workspaceId: r.workspaceId ?? null }));
      },
      readForSession(workspaceId) {
        return {
          global: this.list("global").map((r) => ({ id: r.id, text: r.text })),
          workspace: workspaceId ? this.list("workspace", workspaceId).map((r) => ({ id: r.id, text: r.text })) : [],
        };
      },
      deleteScope(scope, workspaceId) {
        let removed = 0;
        for (const [id, r] of [...rows.entries()]) {
          if (r.scope !== scope) continue;
          if (scope === "workspace" && r.workspaceId !== workspaceId) continue;
          rows.delete(id);
          removed += 1;
        }
        if (scope === "global") mem.global.splice(0, mem.global.length);
        return removed;
      },
    };
  }
  const service: MemoryService = {
    name: "@penglai/memory",
    version: "0.5.3",
    assertReadable,
    modelCannotWriteGlobal,
    write(input, receipt = "manual") {
      return store.write(input, receipt);
    },
    list(scope, workspaceId) {
      return store.list(scope, workspaceId).map((r) => ({ id: r.id, text: r.text, workspaceId: r.workspaceId }));
    },
    readForSession(workspaceId) {
      const { global: g, workspace: w } = store.readForSession(workspaceId);
      return {
        global: g.map((r) => ({ id: r.id, text: r.text })),
        workspace: w.map((r) => ({ id: r.id, text: r.text })),
      };
    },
    deleteScope(scope, workspaceId) {
      return store.deleteScope(scope, workspaceId);
    },
    close() {
      store.close();
    },
  };
  return service;
}
