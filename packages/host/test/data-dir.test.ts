import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { penglaiDataDir } from "../src/data-dir.js";
import { penglaiHome, _setPenglaiHomeForTest } from "../src/conversation-store.js";

afterEach(() => {
  vi.unstubAllEnvs();
  _setPenglaiHomeForTest(null);
});

describe("penglaiDataDir", () => {
  it("uses an explicit desktop-owned application data directory", () => {
    vi.stubEnv("PENGLAI_DATA_DIR", "./isolated-product-data");
    expect(penglaiDataDir()).toBe(path.resolve("./isolated-product-data"));
  });

  it("ignores an empty override", () => {
    vi.stubEnv("PENGLAI_DATA_DIR", "   ");
    expect(penglaiDataDir()).toMatch(/[\\/]\.penglai$/);
  });

  it("keeps penglaiHome on the same root as penglaiDataDir", () => {
    vi.stubEnv("PENGLAI_DATA_DIR", "./isolated-product-data");
    expect(penglaiHome()).toBe(penglaiDataDir());
  });
});
