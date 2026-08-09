import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { completeFiles } from "../src/files-complete.js";

describe("files-complete", () => {
  it("lists matches under root and refuses escape", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-files-"));
    fs.writeFileSync(path.join(root, "readme.md"), "x");
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "main.ts"), "y");
    const hits = completeFiles({ rootPath: root, query: "re" });
    expect(hits.some((h) => h.path === "readme.md")).toBe(true);
    const nested = completeFiles({ rootPath: root, query: "src/m" });
    expect(nested.some((h) => h.path.includes("main.ts"))).toBe(true);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-files-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "outside");
    fs.symlinkSync(outside, path.join(root, "linked-outside"));
    expect(completeFiles({ rootPath: root, query: "linked-outside/" })).toEqual([]);
    expect(completeFiles({ rootPath: root, query: "linked" })).toEqual([]);
  });
});
