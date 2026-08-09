import { describe, expect, it } from "vitest";
import { cleanFinalText, splitModelText } from "../src/output-clean.js";

describe("output-clean", () => {
  it("splits closed think blocks from the user-facing result", () => {
    const split = splitModelText("<think>plan A</think>\n\n最终答案");
    expect(split.thinking).toBe("plan A");
    expect(split.result).toBe("最终答案");
    expect(cleanFinalText("<think>plan A</think>\n\n最终答案")).toBe("最终答案");
  });

  it("treats incomplete open think tags as thinking, not result", () => {
    const split = splitModelText("前言\n<think>unfinished");
    expect(split.result).toBe("前言");
    expect(split.thinking).toContain("unfinished");
  });
});
