import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillStore } from "../src/skills/store.js";

let root: string;
let source: string;
let store: SkillStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-skill-store-"));
  source = path.join(root, "source");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "SKILL.md"), [
    "---",
    "name: office-research",
    "description: Research public pages and prepare an office brief.",
    "---",
    "# Office research",
    "Use web citations and create a DOCX deliverable.",
  ].join("\n"));
  fs.mkdirSync(path.join(source, "references"));
  fs.writeFileSync(path.join(source, "references", "format.md"), "# Format\nKeep citations.");
  store = new SkillStore(path.join(root, "data"));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("SkillStore", () => {
  it("installs, verifies, disables, enables, and removes a local Agent Skill", async () => {
    const installed = await store.install(source);
    expect(installed.name).toBe("office-research");
    expect(installed.files).toBe(2);
    expect(store.loadEnabled()[0]?.content).toContain("create a DOCX");

    store.setEnabled(installed.name, false);
    expect(store.loadEnabled()).toEqual([]);
    expect(store.inspect(installed.name)?.content).toContain("create a DOCX");
    store.setEnabled(installed.name, true);
    expect(store.inspect(installed.name)?.sha256).toBe(installed.sha256);
    expect(store.remove(installed.name)).toBe(true);
    expect(store.list()).toEqual([]);
    if (process.platform !== "win32") {
      expect(fs.statSync(store.root).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(store.root, "index.json")).mode & 0o777).toBe(0o600);
    }
  });

  it("fails closed after installed content is modified without a new receipt", async () => {
    await store.install(source);
    fs.appendFileSync(path.join(store.root, "office-research", "SKILL.md"), "\nInjected");
    expect(() => store.loadEnabled()).toThrow(/integrity/i);
  });

  it("rejects packages with symlinks and invalid frontmatter", async () => {
    fs.symlinkSync(path.join(source, "SKILL.md"), path.join(source, "linked.md"));
    await expect(store.install(source)).rejects.toThrow(/symbolic/i);
    fs.rmSync(path.join(source, "linked.md"));
    fs.writeFileSync(path.join(source, "SKILL.md"), "# Missing frontmatter");
    await expect(store.install(source)).rejects.toThrow(/frontmatter/i);
  });

  it("fails closed for corrupt or symlinked indexes", () => {
    const index = path.join(store.root, "index.json");
    fs.writeFileSync(index, "not-json");
    expect(() => store.list()).toThrow();
    fs.rmSync(index);
    const victim = path.join(root, "victim.json");
    fs.writeFileSync(victim, "owner-data");
    fs.symlinkSync(victim, index);
    expect(() => store.list()).toThrow(/regular file|symlink/i);
    expect(fs.readFileSync(victim, "utf8")).toBe("owner-data");
  });

  it("rejects a symlink used as the skill store root", () => {
    const dataDir = path.join(root, "linked-data");
    const outside = path.join(root, "outside");
    fs.mkdirSync(dataDir);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(dataDir, "skills"), process.platform === "win32" ? "junction" : "dir");
    expect(() => new SkillStore(dataDir)).toThrow(/regular directory/i);
  });
});
