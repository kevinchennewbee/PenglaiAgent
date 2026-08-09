import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOfficeDocument, createPdfDocument, readDocument } from "../src/capabilities/documents.js";
import { assertPublicHttpUrl } from "../src/capabilities/network-safety.js";
import { fetchPublicPage, parsePublicSearchResults } from "../src/capabilities/web.js";

let root: string;
let workspace: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-basic-capabilities-"));
  workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("document broker", () => {
  it("creates a Chinese PDF, refuses overwrite, and reads it back", async () => {
    const output = await createPdfDocument(workspace, {
      path: "交付.pdf",
      title: "蓬莱交付",
      content: "# 验收\n\n这是一个真实的 PDF。\n\n- 中文可读\n- 不覆盖原文件",
    });
    expect(output.path).toBe(path.join(fs.realpathSync(workspace), "交付.pdf"));
    expect(output.bytes).toBeGreaterThan(1_000);
    const raw = fs.readFileSync(output.path);
    expect(raw.subarray(0, 5).toString()).toBe("%PDF-");

    const readBack = await readDocument(workspace, "交付.pdf");
    expect(readBack.format).toBe("pdf");
    expect(readBack.text).toContain("蓬莱交付");
    expect(readBack.text).toContain("中文可读");
    await expect(createPdfDocument(workspace, { path: "交付.pdf", content: "覆盖" })).rejects.toThrow(/overwrite/i);
  });

  it("reads DOCX paragraphs, XLSX sheets and PPTX slide text", async () => {
    const docx = zipSync({
      "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      "word/document.xml": strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>蓬莱文档验收通过</w:t></w:r></w:p></w:body></w:document>'),
    });
    fs.writeFileSync(path.join(workspace, "report.docx"), docx);
    const word = await readDocument(workspace, "report.docx");
    expect(word.text).toContain("蓬莱文档验收通过");

    const xlsxBytes = zipSync({
      "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="数据" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/sharedStrings.xml": strToU8('<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>项目</t></si><si><t>状态</t></si><si><t>蓬莱</t></si><si><t>通过</t></si></sst>'),
      "xl/worksheets/sheet1.xml": strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>'),
    });
    fs.writeFileSync(path.join(workspace, "report.xlsx"), xlsxBytes);
    const xlsx = await readDocument(workspace, "report.xlsx");
    expect(xlsx.text).toContain("# Sheet: 数据");
    expect(xlsx.text).toContain("蓬莱\t通过");

    const pptx = zipSync({
      "ppt/slides/slide1.xml": strToU8('<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><a:t>第一张</a:t><a:t>验收通过</a:t></p:sld>'),
    });
    fs.writeFileSync(path.join(workspace, "slides.pptx"), pptx);
    const slides = await readDocument(workspace, "slides.pptx");
    expect(slides.text).toContain("## Slide 1");
    expect(slides.text).toContain("第一张");
    expect(slides.text).toContain("验收通过");
  });

  it("does not follow an XLSX relationship outside the worksheet namespace", async () => {
    const xlsxBytes = zipSync({
      "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="恶意" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="../../owner-secret.xml"/></Relationships>'),
      "owner-secret.xml": strToU8('<worksheet><sheetData><row><c r="A1"><v>DO_NOT_READ</v></c></row></sheetData></worksheet>'),
    });
    fs.writeFileSync(path.join(workspace, "malicious.xlsx"), xlsxBytes);
    const xlsx = await readDocument(workspace, "malicious.xlsx");
    expect(xlsx.text).toBe("");
    expect(xlsx.text).not.toContain("DO_NOT_READ");
  });

  it("creates standard DOCX, XLSX, and PPTX deliverables and reads them back", async () => {
    const docx = await createOfficeDocument(workspace, {
      path: "brief.docx",
      title: "蓬莱简报",
      content: "# 摘要\n可编辑 Word 交付物\n- 已通过",
    });
    expect(docx.format).toBe("docx");
    expect((await readDocument(workspace, "brief.docx")).text).toContain("可编辑 Word 交付物");

    const xlsx = await createOfficeDocument(workspace, {
      path: "data.xlsx",
      content: "项目\t状态\n蓬莱\t通过",
    });
    expect(xlsx.format).toBe("xlsx");
    expect((await readDocument(workspace, "data.xlsx")).text).toContain("蓬莱\t通过");

    const pptx = await createOfficeDocument(workspace, {
      path: "deck.pptx",
      title: "蓬莱演示",
      content: "# 第一页\n桌面生产力\n# 第二页\nSkill 与 MCP",
    });
    expect(pptx.pages).toBe(2);
    const slideText = (await readDocument(workspace, "deck.pptx")).text;
    expect(slideText).toContain("第一页");
    expect(slideText).toContain("Skill 与 MCP");
  });

  it("refuses paths outside the workspace, including symlink escapes", async () => {
    const outside = path.join(root, "outside.txt");
    fs.writeFileSync(outside, "secret");
    fs.symlinkSync(outside, path.join(workspace, "escape.txt"));
    await expect(readDocument(workspace, "../outside.txt")).rejects.toThrow(/outside/i);
    await expect(readDocument(workspace, "escape.txt")).rejects.toThrow(/outside/i);
    await expect(createPdfDocument(workspace, { path: "../escape.pdf", content: "x" })).rejects.toThrow(/outside/i);
  });

  it("rejects Office ZIP expansion before decompression", async () => {
    const forged = Buffer.from(zipSync({
      "word/document.xml": strToU8("<document/>")
    }));
    const centralDirectory = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(centralDirectory).toBeGreaterThanOrEqual(0);
    forged.writeUInt32LE(101 * 1024 * 1024, centralDirectory + 24);
    fs.writeFileSync(path.join(workspace, "bomb.docx"), forged);
    await expect(readDocument(workspace, "bomb.docx")).rejects.toThrow(/safe ZIP limit/i);
  });
});

describe("web broker", () => {
  it("parses real result URLs and refuses non-http search targets", () => {
    const rows = parsePublicSearchResults(`
      <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Freport">Example report</a><div class="result__snippet">Primary source</div></div>
      <div class="result"><a class="result__a" href="javascript:alert(1)">Unsafe</a></div>
    `, 5);
    expect(rows).toEqual([{ title: "Example report", url: "https://example.com/report", snippet: "Primary source" }]);
  });

  it("rejects private and metadata URLs before fetch", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1/a")).rejects.toThrow(/private|reserved/i);
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/private|reserved/i);
    await expect(assertPublicHttpUrl("http://[::1]/a")).rejects.toThrow(/private|reserved/i);
    await expect(assertPublicHttpUrl("http://[::ffff:7f00:1]/a")).rejects.toThrow(/private|reserved/i);
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow(/http/i);
  });

  it("extracts readable text and revalidates redirects", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/redirect")) {
        return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
      }
      return new Response("<html><head><title>Example</title></head><body><script>bad()</script><main><h1>Hello</h1><p>Readable page.</p></main></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = await fetchPublicPage("https://8.8.8.8/page");
    expect(page.title).toBe("Example");
    expect(page.text).toContain("Readable page.");
    expect(page.text).not.toContain("bad()");
    await expect(fetchPublicPage("https://8.8.8.8/redirect")).rejects.toThrow(/private|reserved/i);
  });
});
