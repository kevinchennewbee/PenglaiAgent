import { Type } from "typebox";
import type { AgentHarnessTool, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import { createOfficeDocument, createPdfDocument, readDocument } from "../capabilities/documents.js";
import { fetchPublicPage, searchPublicWeb } from "../capabilities/web.js";
import { wrapUntrustedContent } from "../security/untrusted-content.js";

type TextToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: undefined;
};

function textResult(text: string): TextToolResult {
  return { content: [{ type: "text", text }], details: undefined };
}

function failed(name: string, error: unknown): TextToolResult {
  return textResult(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
}

export const HOST_TOOL_DOCUMENT_READ = "document_read";
export const HOST_TOOL_DOCUMENT_CREATE_PDF = "document_create_pdf";
export const HOST_TOOL_DOCUMENT_CREATE = "document_create";
export const HOST_TOOL_WEB_SEARCH = "web_search";
export const HOST_TOOL_WEB_FETCH = "web_fetch";

const documentReadSchema = Type.Object({
  path: Type.String({ description: "PDF/DOCX/XLSX/PPTX/text document path inside the current workspace" }),
  max_chars: Type.Optional(Type.Number({ minimum: 1000, maximum: 200000 })),
});

const createPdfSchema = Type.Object({
  path: Type.String({ description: "New .pdf path inside the current workspace; existing files are never overwritten" }),
  title: Type.Optional(Type.String({ description: "Document title" })),
  content: Type.String({ description: "Document body. Markdown-style headings and bullet lines are supported." }),
});

const createDocumentSchema = Type.Object({
  path: Type.String({ description: "New .pdf/.docx/.xlsx/.pptx path inside the workspace; existing files are never overwritten" }),
  title: Type.Optional(Type.String({ description: "Document title" })),
  content: Type.String({ description: "Document body. DOCX/PDF accept headings and bullets; XLSX accepts TSV/CSV rows; PPTX starts a new slide at each '# ' heading." }),
});

const webSearchSchema = Type.Object({
  query: Type.String({ description: "Public web search query; never include secrets or private file contents" }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
});

const webFetchSchema = Type.Object({
  url: Type.String({ description: "Public http/https page URL" }),
  max_chars: Type.Optional(Type.Number({ minimum: 1000, maximum: 100000 })),
});

export interface CapabilityToolOptions {
  workspaceRoot: string;
}

export function createCapabilityTools(
  options: CapabilityToolOptions,
): AgentHarnessTool<ExecutionToolContext>[] {
  const documentRead: AgentHarnessTool<ExecutionToolContext, typeof documentReadSchema> = {
    name: HOST_TOOL_DOCUMENT_READ,
    label: "Read document",
    description:
      "Read a local PDF, DOCX, XLSX, PPTX, Markdown, text, CSV, JSON, HTML, XML, YAML, or RTF file inside the current workspace. Returns extracted text with page/sheet/slide markers where available.",
    parameters: documentReadSchema,
    async execute(_id, params) {
      try {
        const result = await readDocument(options.workspaceRoot, params.path, params.max_chars);
        return textResult(wrapUntrustedContent("document", [
          `path: ${result.path}`,
          `format: ${result.format}`,
          `truncated: ${result.truncated}`,
          "",
          result.text || "(document contained no extractable text)",
        ].join("\n")));
      } catch (error) {
        return failed(HOST_TOOL_DOCUMENT_READ, error);
      }
    },
  };

  const createPdf: AgentHarnessTool<ExecutionToolContext, typeof createPdfSchema> = {
    name: HOST_TOOL_DOCUMENT_CREATE_PDF,
    label: "Create PDF",
    description:
      "Create a new real PDF inside the current workspace from text/Markdown-style content. Supports Chinese through an installed system font and refuses to overwrite existing files.",
    parameters: createPdfSchema,
    async execute(_id, params) {
      try {
        const result = await createPdfDocument(options.workspaceRoot, {
          path: params.path,
          title: params.title,
          content: params.content,
        });
        return textResult(`PDF created\npath: ${result.path}\nbytes: ${result.bytes}\npages: ${result.pages}`);
      } catch (error) {
        return failed(HOST_TOOL_DOCUMENT_CREATE_PDF, error);
      }
    },
  };

  const createDocument: AgentHarnessTool<ExecutionToolContext, typeof createDocumentSchema> = {
    name: HOST_TOOL_DOCUMENT_CREATE,
    label: "Create office document",
    description:
      "Create a new real PDF, DOCX, XLSX, or PPTX inside the workspace. The output is standard OOXML/PDF, readable by Office/LibreOffice, and existing files are never overwritten.",
    parameters: createDocumentSchema,
    async execute(_id, params) {
      try {
        const result = await createOfficeDocument(options.workspaceRoot, {
          path: params.path,
          title: params.title,
          content: params.content,
        });
        return textResult(`Document created\npath: ${result.path}\nformat: ${result.format}\nbytes: ${result.bytes}${result.pages ? `\npages/slides: ${result.pages}` : ""}`);
      } catch (error) {
        return failed(HOST_TOOL_DOCUMENT_CREATE, error);
      }
    },
  };

  const webSearch: AgentHarnessTool<ExecutionToolContext, typeof webSearchSchema> = {
    name: HOST_TOOL_WEB_SEARCH,
    label: "Search web",
    description:
      "Search the live public web. This is an outbound Owner-approved broker. Return and cite the real result URLs; never invent citations.",
    parameters: webSearchSchema,
    async execute(_id, params) {
      try {
        const rows = await searchPublicWeb(params.query, params.limit ?? 5);
        if (rows.length === 0) return textResult(wrapUntrustedContent("web_search", "No public search results found."));
        return textResult(wrapUntrustedContent(
          "web_search",
          rows.map((row, index) => `${index + 1}. ${row.title}\n${row.url}\n${row.snippet}`).join("\n\n"),
        ));
      } catch (error) {
        return failed(HOST_TOOL_WEB_SEARCH, error);
      }
    },
  };

  const webFetch: AgentHarnessTool<ExecutionToolContext, typeof webFetchSchema> = {
    name: HOST_TOOL_WEB_FETCH,
    label: "Fetch web page",
    description:
      "Fetch and extract readable text from one public static HTTP/HTTPS page. Redirects and DNS are revalidated against SSRF; private/local networks and oversized responses are refused. Cite the final URL in the answer.",
    parameters: webFetchSchema,
    async execute(_id, params) {
      try {
        const result = await fetchPublicPage(params.url);
        const limit = Math.max(1_000, Math.min(100_000, Math.floor(params.max_chars ?? 50_000)));
        const clipped = result.text.length > limit;
        return textResult(wrapUntrustedContent("web_page", [
          `url: ${result.url}`,
          `status: ${result.status}`,
          `content-type: ${result.contentType}`,
          `title: ${result.title || "(untitled)"}`,
          `truncated: ${result.truncated || clipped}`,
          "",
          result.text.slice(0, limit) || "(page contained no extractable text)",
        ].join("\n")));
      } catch (error) {
        return failed(HOST_TOOL_WEB_FETCH, error);
      }
    },
  };

  return [documentRead, createPdf, createDocument, webSearch, webFetch];
}
