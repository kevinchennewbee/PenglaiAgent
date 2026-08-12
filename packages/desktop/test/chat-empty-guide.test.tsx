/**
 * W2 ChatEmptyGuide — empty conversation branches for add-source vs suggestions.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatEmptyGuide } from "../src/ui/ChatPanel.js";
import type { PenglaiBridge } from "../src/bridge/types.js";

function bridgeWith(handlers: Record<string, unknown>): PenglaiBridge {
  return {
    kind: "http",
    status: async () => ({ ok: true }),
    rpc: async (method: string) => {
      if (!(method in handlers)) throw new Error(`unexpected rpc ${method}`);
      return handlers[method];
    },
    subscribe: async () => () => {},
    home: async () => null,
  };
}

describe("W2 ChatEmptyGuide", () => {
  it("SSR initial frame shows loading copy before effects resolve", () => {
    const html = renderToStaticMarkup(
      <ChatEmptyGuide bridge={null} onAsk={() => undefined} />,
    );
    expect(html).toContain("正在确认个人上下文");
    expect(html).toContain("从一句话开始");
  });

  it("suggestion RPC contract stays path-free and capped", async () => {
    const bridge = bridgeWith({
      "context.source.list": { sources: [{ id: "s1" }] },
      "context.suggestions": {
        suggestions: [
          {
            question: "「合同」里讲了什么？",
            documentTitle: "合同",
            relativePath: "合同.md",
          },
        ],
      },
    });
    const listed = await bridge.rpc("context.source.list", {});
    expect(listed.sources).toHaveLength(1);
    const sug = await bridge.rpc<{
      suggestions: Array<{ relativePath: string; question: string }>;
    }>("context.suggestions", { globalOnly: true, limit: 3 });
    expect(sug.suggestions.length).toBeLessThanOrEqual(3);
    expect(sug.suggestions[0]!.relativePath).not.toMatch(/^\//);
    expect(sug.suggestions[0]!.question).toContain("合同");
  });
});
