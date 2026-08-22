import { mkdirSync } from "node:fs";
import { PenglaiError } from "@penglai/contracts";
import { MnemonRunner } from "./runner.js";
import { parseMnemonDot, type DotGraph } from "./dot.js";

function parseJson(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new PenglaiError("DSH_UNAVAILABLE", "mnemon output is not JSON");
  }
}

export class MnemonAdapter {
  constructor(
    private readonly runner: MnemonRunner,
    private readonly dataDir: string,
  ) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  }

  async remember(content: string, flags: { cat?: string; tags?: string; source?: string } = {}) {
    const result = await this.runner.run({
      command: "remember",
      dataDir: this.dataDir,
      positionals: [content],
      flags: {
        ...(flags.cat ? { "--cat": flags.cat } : {}),
        ...(flags.tags ? { "--tags": flags.tags } : {}),
        ...(flags.source ? { "--source": flags.source } : {}),
      },
    });
    if (result.exitCode !== 0) throw new PenglaiError("DSH_UNAVAILABLE", "mnemon remember failed");
    return parseJson(result.stdout) as { id: string; content: string; category: string; tags?: string[] };
  }

  async search(query: string, limit = 10) {
    const result = await this.runner.run({
      command: "search",
      dataDir: this.dataDir,
      positionals: [query],
      flags: { "--limit": limit },
    });
    if (result.exitCode !== 0) throw new PenglaiError("DSH_UNAVAILABLE", "mnemon search failed");
    const parsed = parseJson(result.stdout);
    return Array.isArray(parsed) ? parsed : [];
  }

  async recall(query: string, limit = 10) {
    const result = await this.runner.run({
      command: "recall",
      dataDir: this.dataDir,
      positionals: [query],
      flags: { "--limit": limit },
    });
    if (result.exitCode !== 0) throw new PenglaiError("DSH_UNAVAILABLE", "mnemon recall failed");
    return parseJson(result.stdout) as { results?: Array<{ id: string; content: string }> };
  }

  async related(id: string) {
    const result = await this.runner.run({
      command: "related",
      dataDir: this.dataDir,
      positionals: [id],
    });
    if (result.exitCode !== 0) throw new PenglaiError("DSH_UNAVAILABLE", "mnemon related failed");
    return parseJson(result.stdout);
  }

  async forget(id: string) {
    const result = await this.runner.run({
      command: "forget",
      dataDir: this.dataDir,
      positionals: [id],
    });
    if (result.exitCode !== 0) throw new PenglaiError("DSH_UNAVAILABLE", "mnemon forget failed");
    return parseJson(result.stdout);
  }

  async link(from: string, to: string) {
    const result = await this.runner.run({
      command: "link",
      dataDir: this.dataDir,
      positionals: [from, to],
      flags: { "--type": "temporal" },
    });
    if (result.exitCode !== 0) throw new PenglaiError("DSH_UNAVAILABLE", "mnemon link failed");
    return result.stdout;
  }

  async status() {
    const result = await this.runner.run({ command: "status", dataDir: this.dataDir });
    if (result.exitCode !== 0) throw new PenglaiError("DSH_UNAVAILABLE", "mnemon status failed");
    return parseJson(result.stdout) as { total_insights?: number; db_path?: string };
  }

  async vizDot(): Promise<DotGraph> {
    const result = await this.runner.run({
      command: "viz",
      dataDir: this.dataDir,
      flags: { "--format": "dot" },
    });
    if (result.exitCode !== 0 || !result.stdout.includes("digraph")) {
      throw new PenglaiError("DSH_UNAVAILABLE", "mnemon viz did not emit DOT");
    }
    return parseMnemonDot(result.stdout);
  }
}
