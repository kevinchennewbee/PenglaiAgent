/**
 * Workspace Path Jail tests.
 *
 * Validates the Boundary contract: file operations cannot escape the
 * workspace root via "..", absolute paths, or parent directories.
 * See docs/0.4/01-CONSTITUTION.md §3.2 (Boundary).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { isWithinWorkspace, assertInWorkspace, resolveInWorkspace } from "../src/jail.js";

let root: string;
let outsideFile: string;
let testRoot: string;

beforeAll(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-jail-"));
  root = path.join(testRoot, "workspace");
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(path.join(root, "file.txt"), "hello\n");
  outsideFile = path.join(testRoot, "outside.txt");
  fs.writeFileSync(outsideFile, "secret\n");
});

afterAll(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe("jail: isWithinWorkspace", () => {
  it("allows a path inside the workspace (relative)", () => {
    expect(isWithinWorkspace(root, "file.txt")).toBe(true);
    expect(isWithinWorkspace(root, "sub/deep.txt")).toBe(true);
  });

  it("allows an absolute path inside the workspace", () => {
    expect(isWithinWorkspace(root, path.join(root, "file.txt"))).toBe(true);
    expect(isWithinWorkspace(root, path.join(root, "sub", "deep.txt"))).toBe(true);
  });

  it("allows the workspace root itself", () => {
    expect(isWithinWorkspace(root, root)).toBe(true);
  });

  it("denies a path with '..' traversal", () => {
    expect(isWithinWorkspace(root, "../penglai-jail-outside.txt")).toBe(false);
    expect(isWithinWorkspace(root, path.join("sub", "..", "..", "penglai-jail-outside.txt"))).toBe(false);
  });

  it("denies an absolute path outside the workspace", () => {
    expect(isWithinWorkspace(root, outsideFile)).toBe(false);
  });

  it("denies a sibling/parent directory that is not beneath the root", () => {
    expect(isWithinWorkspace(root, os.tmpdir())).toBe(false);
  });

  it("does not false-match on a shared prefix (workspace-evil)", () => {
    const sibling = root + "-evil";
    fs.mkdirSync(sibling, { recursive: true });
    try {
      expect(isWithinWorkspace(root, path.join(sibling, "x.txt"))).toBe(false);
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });
});

describe("jail: assertInWorkspace", () => {
  it("does not throw for paths inside", () => {
    expect(() => assertInWorkspace(root, "file.txt")).not.toThrow();
    expect(() => assertInWorkspace(root, path.join(root, "sub", "x"))).not.toThrow();
  });

  it("throws for paths outside", () => {
    expect(() => assertInWorkspace(root, "../penglai-jail-outside.txt")).toThrow();
    expect(() => assertInWorkspace(root, outsideFile)).toThrow();
  });
});

describe("jail: resolveInWorkspace", () => {
  it("resolves a relative path to an absolute workspace path", () => {
    expect(resolveInWorkspace(root, "file.txt")).toBe(path.join(root, "file.txt"));
  });

  it("rejects an escaping relative path", () => {
    expect(() => resolveInWorkspace(root, "../penglai-jail-outside.txt")).toThrow();
  });
});
