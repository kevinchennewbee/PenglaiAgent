import { useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return plainText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const source = plainText(children).replace(/\n$/, "");
  return (
    <div className="markdown-code-block">
      <button
        type="button"
        className="markdown-copy"
        onClick={() => {
          void navigator.clipboard.writeText(source).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
          });
        }}
      >
        {copied ? "已复制" : "复制"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

function publicHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Safe assistant Markdown: no raw HTML, remote images, or non-HTTP links. */
export function MarkdownMessage({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className={streaming ? "markdown-message streaming-markdown" : "markdown-message"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            const safe = publicHref(href);
            return safe ? (
              <a
                href={safe}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  void openUrl(safe).catch(() => window.open(safe, "_blank", "noopener,noreferrer"));
                }}
              >
                {children}
              </a>
            ) : (
              <span className="unsafe-link" title="仅允许打开 http/https 外链">{children}</span>
            );
          },
          img({ alt }) {
            return <span className="remote-image-blocked">[远程图片已阻止{alt ? `：${alt}` : ""}]</span>;
          },
          pre({ children }) {
            return <CodeBlock>{children}</CodeBlock>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
      {streaming && <i className="stream-cursor" />}
    </div>
  );
}
