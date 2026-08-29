#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const EXPECTED_ALPHA_SHA = "cd5ef8148158c3a752a658978873241fdf8e2bbc";

function fail(message) {
  process.stderr.write(`DSH_ALPHA_OWNER_REMOTES_FAIL ${message}\n`);
  process.exit(1);
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function source(root, relative) {
  const path = join(root, relative);
  if (!existsSync(path)) fail(`fixed source is missing ${relative}`);
  return readFileSync(path, "utf8");
}

function requireTokens(label, text, tokens) {
  const missing = tokens.filter((token) => !text.includes(token));
  assert.deepEqual(missing, [], `${label} lost fixed-source contracts: ${missing.join(", ")}`);
}

const checkoutArg = process.argv[2] ?? process.env.PENGLAI_DSH_ALPHA_SOURCE;
if (!checkoutArg) fail("pass the fixed alpha source checkout path");
const checkout = resolve(checkoutArg);
if (!existsSync(join(checkout, "pnpm-lock.yaml"))) fail("source checkout is missing pnpm-lock.yaml");
if (git(checkout, ["rev-parse", "HEAD"]) !== EXPECTED_ALPHA_SHA) fail("source checkout HEAD drifted");
if (git(checkout, ["status", "--porcelain"])) fail("source checkout is dirty");

const sessionController = source(checkout, "packages/api/session-controller/src/index.ts");
requireTokens("Session Controller", sessionController, [
  "namespace: 'session'",
  "@Remote('list')",
  "@Remote('create')",
  "@Remote('rename')",
  "@Remote('modelCatalog')",
  "@Remote('selectModel')",
]);

const sessionTypes = source(checkout, "packages/api/session-controller/src/types.ts");
requireTokens("Session wire types", sessionTypes, [
  "export interface SessionCreateRequest",
  "readonly workspaceId?: WorkspaceId",
  "export interface SessionSummary",
  "readonly projections?: SessionProjectionHints",
  "export interface ModelCatalog",
  "readonly routableProviders: readonly string[]",
  "export interface SessionSelectModelRequest extends ModelSelection",
  "export interface SessionRenameRequest",
  "readonly title: string",
]);

const sessionClient = source(checkout, "packages/api/session-controller/src/client/index.ts");
requireTokens("Session client graph", sessionClient, [
  "'remote.session'",
  "const remotes = ctx.remote as unknown as SessionRemotes",
  "new ClientSessions(ctx, remotes)",
]);

const workspaceController = source(checkout, "packages/api/workspace-controller/src/index.ts");
requireTokens("Workspace Controller", workspaceController, [
  "namespace: 'workspace'",
  "@Remote('create')",
  "@Remote('insertSessionBefore')",
  "@Remote('archiveSession')",
  "@Remote({ mode: 'stream' })",
]);

const workspaceTypes = source(checkout, "packages/api/workspace-controller/src/types.ts");
requireTokens("Workspace wire types", workspaceTypes, [
  "export interface WorkspaceView",
  "readonly workspaceId: WorkspaceId",
  "readonly sessionIds: readonly SessionId[]",
  "export type WorkspaceFollowFrame",
]);

const workspaceClient = source(checkout, "packages/api/workspace-controller/src/client/index.ts");
requireTokens("Workspace client graph", workspaceClient, [
  "'remote.workspace'",
  "new ClientWorkspaceModel(remote.workspace)",
  "remote.workspace.follow(signal)",
]);

const removedApiProxy = git(checkout, [
  "ls-tree",
  "-r",
  "--name-only",
  "HEAD",
  "--",
  "packages/api",
]).split("\n").filter((path) => /apiproxy/i.test(path));
assert.deepEqual(removedApiProxy, [], `alpha API tree still contains ApiProxy: ${removedApiProxy.join(", ")}`);

process.stdout.write(`${JSON.stringify({
  status: "PASS",
  alphaSha: EXPECTED_ALPHA_SHA,
  owners: {
    session: ["list", "create", "rename", "modelCatalog", "selectModel"],
    workspace: ["create", "insertSessionBefore", "archiveSession", "follow"],
  },
  clientGraph: ["remote.session", "remote.workspace"],
  apiProxyPaths: 0,
})}\n`);
