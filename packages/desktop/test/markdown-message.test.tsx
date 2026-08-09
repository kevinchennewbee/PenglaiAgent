import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownMessage } from "../src/ui/MarkdownMessage.js";

describe("assistant Markdown", () => {
  it("renders GFM without raw HTML or remote image loads", () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage text={[
        "# Report",
        "| A | B |",
        "|---|---|",
        "| 1 | 2 |",
        "[source](https://example.com/report)",
        "![tracker](https://evil.example/pixel.png)",
        "<script>alert(1)</script>",
        "```ts",
        "const ok = true;",
        "```",
      ].join("\n")} />,
    );
    expect(html).toContain("<table>");
    expect(html).toContain('target="_blank"');
    expect(html).toContain("远程图片已阻止");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("markdown-copy");
  });
});
