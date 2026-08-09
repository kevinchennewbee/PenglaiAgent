import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { previewArtifactFile } from "../src/artifact-preview.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("artifact preview", () => {
  it("previews source and document text inside the workspace", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-preview-"));
    roots.push(root);
    const source = path.join(root, "example.ts");
    const markdown = path.join(root, "notes.md");
    fs.writeFileSync(source, "export const answer = 42;\n", "utf-8");
    fs.writeFileSync(markdown, "# 标题\n正文\n", "utf-8");
    expect((await previewArtifactFile(root, source)).text).toContain("answer");
    expect((await previewArtifactFile(root, markdown)).text).toContain("标题");
  });

  it("rejects unsupported binary artifacts", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-preview-"));
    roots.push(root);
    const binary = path.join(root, "archive.zip");
    fs.writeFileSync(binary, Buffer.from([0, 1, 2, 3]));
    await expect(previewArtifactFile(root, binary)).rejects.toThrow(/not available/);
  });
});
