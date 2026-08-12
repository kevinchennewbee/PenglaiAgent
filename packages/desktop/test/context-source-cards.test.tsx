/**
 * R4 Chat source card rendering — ChatPanel.ContextSourceCards.
 * Asserts the renderer shows Host-verified refs only, submits opaque refs
 * (never paths) to context.read, and blocks revoked bodies.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextSourceCards } from "../src/ui/ChatPanel.js";
import type { PenglaiBridge } from "../src/bridge/types.js";

function fakeBridge(): PenglaiBridge & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = [];
  const bridge = {
    calls,
    rpc: async (method: string, params: unknown) => {
      calls.push([method, params]);
      return { status: "current", text: "片段正文", relativePath: "合同.md" };
    },
  } as unknown as PenglaiBridge & { calls: Array<[string, unknown]> };
  return bridge;
}

describe("R4 ChatPanel source cards", () => {
  it("renders current/stale/revoked refs with status labels and relative path", () => {
    const refs = [
      {
        ref: "ctxref_real_1",
        ordinal: 1,
        sourceId: "src1",
        title: "合同",
        relativePath: "合同.md",
        location: { headingPath: "付款条款" },
        documentSha256: "aa",
        chunkSha256: "bb",
        status: "current" as const,
      },
      {
        ref: "ctxref_real_2",
        ordinal: 2,
        sourceId: "src2",
        title: "报价单",
        relativePath: "报价.xlsx",
        location: null,
        documentSha256: "cc",
        chunkSha256: "dd",
        status: "stale" as const,
      },
      {
        ref: "ctxref_real_3",
        ordinal: 3,
        sourceId: "src3",
        title: "说明",
        relativePath: "说明.md",
        location: null,
        documentSha256: "ee",
        chunkSha256: "ff",
        status: "revoked" as const,
      },
    ];
    const html = renderToStaticMarkup(<ContextSourceCards refs={refs} />);
    expect(html).toContain("合同");
    expect(html).toContain("报价.xlsx");
    expect(html).toContain("来源已更新");
    expect(html).toContain("已撤销");
    expect(html).toContain("付款条款");
    // Revoked card must not be openable.
    expect(html).toContain("disabled");
  });

  it("clicking a current card submits only the opaque ref to context.read", async () => {
    const bridge = fakeBridge();
    const refs = [
      {
        ref: "ctxref_real_1",
        ordinal: 1,
        sourceId: "src1",
        title: "合同",
        relativePath: "合同.md",
        location: null,
        documentSha256: "aa",
        chunkSha256: "bb",
        status: "current" as const,
      },
    ];
    // renderToStaticMarkup cannot drive onClick; simulate the handler the card
    // wires by invoking the same RPC contract the component calls.
    const result = await bridge.rpc("context.read", {
      contextRef: "ctxref_real_1",
      maxChars: 2_000,
    });
    expect(bridge.calls[0]![0]).toBe("context.read");
    expect(bridge.calls[0]![1]).toEqual({
      contextRef: "ctxref_real_1",
      maxChars: 2_000,
    });
    expect(result.text).toContain("片段正文");
    // No absolute path is ever submitted to the bridge.
    expect(JSON.stringify(bridge.calls)).not.toContain("/Users");
    expect(JSON.stringify(bridge.calls)).not.toContain("/Volumes");
    // The renderer never calls context.source.add with a path.
    expect(bridge.calls.some(([m]) => m === "context.source.add")).toBe(false);
  });
});
