/**
 * Conversation TODO workbench for the single chat surface.
 *
 * Persistence: ~/.penglai/conversations/<id>/workbench.json
 * Legacy subagent/job rows remain readable for compatibility, but this module
 * no longer creates, updates, executes, or injects them into a conversation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type {
  ConversationTodo,
  ConversationTodoStatus,
  ConversationWorkbench,
} from "@penglai/protocol";
import { penglaiHome } from "./conversation-store.js";
import {
  atomicWritePrivateJson,
  ensurePrivateDirectory,
  readPrivateTextFile,
} from "./security/private-file.js";

const MAX_TODOS = 40;
const MAX_LEGACY_SUBAGENTS = 20;
const MAX_LEGACY_JOBS = 20;
const MAX_WORKBENCH_BYTES = 2 * 1024 * 1024;

function assertValidConversationId(conversationId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(conversationId)) {
    throw new Error(`invalid conversationId: ${JSON.stringify(conversationId)}`);
  }
}

function workbenchPath(conversationId: string): string {
  assertValidConversationId(conversationId);
  return path.join(penglaiHome(), "conversations", conversationId, "workbench.json");
}

function emptyWorkbench(): ConversationWorkbench {
  return { todos: [], subagents: [], jobs: [], updatedAt: Date.now() };
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function loadWorkbench(conversationId: string): ConversationWorkbench {
  const base = path.join(penglaiHome(), "conversations");
  if (!fs.existsSync(base)) return emptyWorkbench();
  ensurePrivateDirectory(base);
  const file = workbenchPath(conversationId);
  try {
    const raw = JSON.parse(readPrivateTextFile(file, MAX_WORKBENCH_BYTES, true).text) as ConversationWorkbench;
    return {
      todos: Array.isArray(raw.todos) ? raw.todos : [],
      subagents: Array.isArray(raw.subagents) ? raw.subagents : [],
      jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyWorkbench();
    if (error instanceof Error && error.message.startsWith("Private")) throw error;
    return emptyWorkbench();
  }
}

export function saveWorkbench(
  conversationId: string,
  wb: ConversationWorkbench,
): ConversationWorkbench {
  assertValidConversationId(conversationId);
  ensurePrivateDirectory(path.join(penglaiHome(), "conversations"));
  const dir = path.dirname(workbenchPath(conversationId));
  ensurePrivateDirectory(dir);
  const next: ConversationWorkbench = {
    todos: wb.todos.slice(0, MAX_TODOS),
    // Preserve bounded legacy history on TODO writes. There is deliberately
    // no mutation API for either collection anymore.
    subagents: wb.subagents.slice(0, MAX_LEGACY_SUBAGENTS),
    jobs: wb.jobs.slice(0, MAX_LEGACY_JOBS),
    updatedAt: Date.now(),
  };
  const file = workbenchPath(conversationId);
  atomicWritePrivateJson(file, next, MAX_WORKBENCH_BYTES);
  return next;
}

export function setTodos(
  conversationId: string,
  items: Array<{ id?: string; content: string; status?: ConversationTodoStatus }>,
): ConversationWorkbench {
  const now = Date.now();
  const todos: ConversationTodo[] = items.slice(0, MAX_TODOS).map((item) => {
    const status = item.status ?? "pending";
    return {
      id: item.id?.trim() || id("todo"),
      content: item.content.trim().slice(0, 500),
      status,
      createdAt: now,
      updatedAt: now,
    };
  });
  const wb = loadWorkbench(conversationId);
  return saveWorkbench(conversationId, { ...wb, todos });
}

export function upsertTodo(
  conversationId: string,
  input: { id?: string; content?: string; status?: ConversationTodoStatus },
): ConversationWorkbench {
  const wb = loadWorkbench(conversationId);
  const now = Date.now();
  if (input.id) {
    const idx = wb.todos.findIndex((todo) => todo.id === input.id);
    if (idx >= 0) {
      wb.todos[idx] = {
        ...wb.todos[idx],
        content: input.content?.trim() || wb.todos[idx].content,
        status: input.status ?? wb.todos[idx].status,
        updatedAt: now,
      };
      return saveWorkbench(conversationId, wb);
    }
  }
  if (!input.content?.trim()) return wb;
  wb.todos.unshift({
    id: input.id?.trim() || id("todo"),
    content: input.content.trim().slice(0, 500),
    status: input.status ?? "pending",
    createdAt: now,
    updatedAt: now,
  });
  return saveWorkbench(conversationId, wb);
}

export function removeTodo(conversationId: string, todoId: string): ConversationWorkbench {
  const wb = loadWorkbench(conversationId);
  return saveWorkbench(conversationId, {
    ...wb,
    todos: wb.todos.filter((todo) => todo.id !== todoId),
  });
}

/** System-prompt injection for active TODOs only. */
export function buildWorkbenchInjection(conversationId: string): string {
  const wb = loadWorkbench(conversationId);
  const lines: string[] = [];
  const openTodos = wb.todos.filter(
    (todo) => todo.status === "pending" || todo.status === "in_progress",
  );
  if (openTodos.length > 0) {
    lines.push("SESSION TODOS (owner-maintained context; use them for orientation):");
    for (const todo of openTodos.slice(0, 20)) {
      lines.push(`- [${todo.status}] ${todo.content}`);
    }
  }
  return lines.join("\n");
}
