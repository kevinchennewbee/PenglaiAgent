import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildUsageStats, recordModelUsage } from "../src/usage-stats.js";
import type { UsageReport } from "@penglai/protocol";

describe("usage-stats", () => {
  it("aggregates daily and model stats for a range", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-usage-"));
    recordModelUsage(dir, { model: "MiniMax-M3", tokens: 1000, day: "2026-07-28" });
    recordModelUsage(dir, { model: "MiniMax-M3", tokens: 500, day: "2026-07-29" });
    recordModelUsage(dir, { model: "grok-4.5", tokens: 200, day: "2026-07-29" });
    const report: UsageReport = {
      totalTokens: 1700,
      totalRequests: 3,
      inputTokens: 1000,
      outputTokens: 700,
      rows: [
        {
          day: "2026-07-28",
          mode: "chat",
          projectId: "",
          inputTokens: 600,
          outputTokens: 400,
          requests: 1,
          updatedAt: 1,
        },
        {
          day: "2026-07-29",
          mode: "chat",
          projectId: "",
          inputTokens: 400,
          outputTokens: 300,
          requests: 2,
          updatedAt: 2,
        },
      ],
    };
    const stats = buildUsageStats(report, dir, "all");
    expect(stats.totalTokens).toBe(1700);
    expect(stats.activeDays).toBe(2);
    expect(stats.byModel[0]?.model).toBe("MiniMax-M3");
    expect(stats.topModel?.model).toBe("MiniMax-M3");
  });
});
