import { existsSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";
import { EXIT_BY_VERDICT } from "./lib/exit-contract.mjs";
import { beginEvidenceRun, finishEvidenceRun, recordCommand, recordArtifact, HOST_TARGET } from "./lib/evidence-dir.mjs";
import { createDocument, edit, inspect } from "../packages/office/src/service.ts";

const run = beginEvidenceRun({ command: "verify:office-real", target: HOST_TARGET });
function locate(name) {
  const command = process.platform === "win32" ? "where.exe" : "which";
  return spawnSync(command, [name], { encoding: "utf8" });
}
const unzip = locate("unzip");
const pdftotext = locate("pdftotext");
const pdfinfo = locate("pdfinfo");
const pdftoppm = locate("pdftoppm");
const python = locate(process.platform === "win32" ? "python.exe" : "python3");
for (const [name, found] of Object.entries({ unzip, pdftotext, pdfinfo, pdftoppm, python })) {
  recordCommand(run, { argv: ["locate", name], exitCode: found.status, stdout: found.stdout, stderr: found.stderr });
}

const pkg = JSON.parse(readFileSync(join(ROOT, "packages/office/package.json"), "utf8"));
if (/univerjs-pro|dsh-univer-office/.test(JSON.stringify(pkg))) {
  const manifest = finishEvidenceRun(run, "FAIL", "Univer Pro forbidden");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

const dir = mkdtempSync(join(tmpdir(), "penglai-office-real-"));
const docx = await createDocument("docx", "Penglai Office DOCX probe 世界");
const xlsx = await createDocument("xlsx", "Penglai Office XLSX probe");
const pptx = await createDocument("pptx", "Penglai Office PPTX probe");
const arbitraryChinese = "蓬莱用户正在完整测试办公编辑、模板与中文字体，标点：你好！数字 2026。";
const pdf = await createDocument("pdf", arbitraryChinese);
const editedXlsx = await edit(xlsx.bytes, { kind: "xlsx.setCell", cell: "B1", value: "typed-cell" });
const editedDocx = await edit(docx.bytes, { kind: "docx.replaceParagraph", paragraphIndex: 0, text: "typed-paragraph" });
const editedPptx = await edit(pptx.bytes, { kind: "pptx.replaceSlideText", slideIndex: 0, text: "typed-slide" });
const editedPdf = await edit(pdf.bytes, { kind: "pdf.watermark", text: "蓬莱水印" });

const paths = {
  docx: join(dir, "docx-probe.docx"),
  xlsx: join(dir, "xlsx-probe.xlsx"),
  pptx: join(dir, "pptx-probe.pptx"),
  pdf: join(dir, "pdf-probe.pdf"),
};
writeFileSync(paths.docx, editedDocx.bytes);
writeFileSync(paths.xlsx, editedXlsx.bytes);
writeFileSync(paths.pptx, editedPptx.bytes);
writeFileSync(paths.pdf, editedPdf.bytes);
for (const [name, path] of Object.entries(paths)) {
  recordArtifact(run, path, name === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument");
}

const seenPdf = await inspect(editedPdf.bytes);
if (seenPdf.format !== "pdf" || !seenPdf.text.includes(arbitraryChinese)) {
  const manifest = finishEvidenceRun(run, "FAIL", "created PDF metadata did not retain source text");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

if (unzip.status !== 0) {
  const manifest = finishEvidenceRun(run, "INCOMPLETE", "system ZIP verifier missing; cannot independently verify OOXML containers");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason, dir: run.dir }));
  process.exit(EXIT_BY_VERDICT.INCOMPLETE);
}

const unzipBin = unzip.stdout.trim().split(/\r?\n/)[0];
const ooxmlChecks = [
  { kind: "docx", path: paths.docx, required: ["[Content_Types].xml", "_rels/.rels", "word/document.xml"], marker: "typed-paragraph" },
  { kind: "xlsx", path: paths.xlsx, required: ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/worksheets/sheet1.xml"], marker: "typed-cell" },
  { kind: "pptx", path: paths.pptx, required: ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/slides/slide1.xml"], marker: "typed-slide" },
];
for (const check of ooxmlChecks) {
  const tested = spawnSync(unzipBin, ["-t", check.path], { encoding: "utf8", timeout: 120000 });
  recordCommand(run, { argv: [unzipBin, "-t", check.path], exitCode: tested.status, stdout: tested.stdout, stderr: tested.stderr });
  const listed = spawnSync(unzipBin, ["-Z1", check.path], { encoding: "utf8", timeout: 120000 });
  recordCommand(run, { argv: [unzipBin, "-Z1", check.path], exitCode: listed.status, stdout: listed.stdout, stderr: listed.stderr });
  const entries = new Set(String(listed.stdout).split(/\r?\n/).filter(Boolean));
  const xml = spawnSync(unzipBin, ["-p", check.path, "*.xml"], { encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  recordCommand(run, { argv: [unzipBin, "-p", check.path, "*.xml"], exitCode: xml.status, stdout: "", stderr: xml.stderr });
  if (
    tested.status !== 0 ||
    listed.status !== 0 ||
    xml.status !== 0 ||
    check.required.some((entry) => !entries.has(entry)) ||
    !String(xml.stdout).includes(check.marker)
  ) {
    const manifest = finishEvidenceRun(run, "FAIL", `independent ZIP/OOXML verification rejected ${check.kind}`);
    console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
    process.exit(EXIT_BY_VERDICT.FAIL);
  }
}

let poppler = "NOT_RUN";
let pdfTextVerifier = "NOT_RUN";
if (pdfinfo.status === 0) {
  const infoBin = pdfinfo.stdout.trim();
  const info = spawnSync(infoBin, [paths.pdf], { encoding: "utf8" });
  recordCommand(run, { argv: [infoBin, paths.pdf], exitCode: info.status, stdout: info.stdout, stderr: info.stderr });
  if (info.status !== 0) {
    const manifest = finishEvidenceRun(run, "FAIL", "pdfinfo rejected office PDF", { stderr: info.stderr });
    console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
    process.exit(EXIT_BY_VERDICT.FAIL);
  }
  if (pdftotext.status === 0) {
    const textBin = pdftotext.stdout.trim();
    const textPath = join(dir, "pdf-probe.txt");
    const text = spawnSync(textBin, [paths.pdf, textPath], { encoding: "utf8" });
    recordCommand(run, { argv: [textBin, paths.pdf, textPath], exitCode: text.status, stdout: text.stdout, stderr: text.stderr });
    const extracted = text.status === 0 ? readFileSync(textPath, "utf8") : "";
    const normalizedExtracted = extracted.replace(/\s+/g, " ").trim();
    if (text.status !== 0 || !normalizedExtracted.includes(arbitraryChinese) || !normalizedExtracted.includes("蓬莱水印")) {
      const manifest = finishEvidenceRun(run, "FAIL", "pdftotext did not independently read the CJK PDF");
      console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
      process.exit(EXIT_BY_VERDICT.FAIL);
    }
    pdfTextVerifier = "pdftotext";
  } else if (python.status === 0) {
    const pythonBin = python.stdout.trim().split(/\r?\n/)[0];
    const assertion = [
      "import sys",
      "from pypdf import PdfReader",
      "t=''.join(p.extract_text() or '' for p in PdfReader(sys.argv[1]).pages)",
      `sys.exit(0 if ${JSON.stringify(arbitraryChinese)} in t and ${JSON.stringify("蓬莱水印")} in t else 7)`,
    ].join("; ");
    const text = spawnSync(pythonBin, ["-c", assertion, paths.pdf], { encoding: "utf8" });
    recordCommand(run, {
      argv: ["python", "-c", "pypdf exact CJK assertion", paths.pdf],
      exitCode: text.status,
      stdout: "",
      stderr: text.stderr,
    });
    if (text.status !== 0) {
      const manifest = finishEvidenceRun(run, "FAIL", "pypdf did not independently read the CJK PDF");
      console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
      process.exit(EXIT_BY_VERDICT.FAIL);
    }
    pdfTextVerifier = "pypdf";
  } else {
    const manifest = finishEvidenceRun(run, "INCOMPLETE", "PDF text verifier missing after pdfinfo PASS");
    console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason, dir: run.dir }));
    process.exit(EXIT_BY_VERDICT.INCOMPLETE);
  }
  if (pdftoppm.status === 0) {
    const renderBin = pdftoppm.stdout.trim();
    const renderBase = join(dir, "pdf-render");
    const render = spawnSync(renderBin, ["-f", "1", "-singlefile", "-png", "-r", "100", paths.pdf, renderBase], { encoding: "utf8" });
    recordCommand(run, { argv: [renderBin, "render-page-1", paths.pdf], exitCode: render.status, stdout: render.stdout, stderr: render.stderr });
    if (render.status !== 0 || !existsSync(`${renderBase}.png`)) {
      const manifest = finishEvidenceRun(run, "FAIL", "pdftoppm did not render office PDF");
      console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
      process.exit(EXIT_BY_VERDICT.FAIL);
    }
    recordArtifact(run, `${renderBase}.png`, "image/png");
  }
  poppler = "PASS";
} else {
  const manifest = finishEvidenceRun(run, "INCOMPLETE", "Poppler pdfinfo missing; cannot independently verify PDF");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason, dir: run.dir }));
  process.exit(EXIT_BY_VERDICT.INCOMPLETE);
}

const manifest = finishEvidenceRun(run, "PASS", "system ZIP/OOXML and Poppler checks accepted office artifacts", {
  poppler,
  pdfTextVerifier,
  ooxmlVerifier: "system-unzip",
  fixtureOrigin: "penglai-office-engine",
});
console.log(JSON.stringify({ verdict: manifest.verdict, command: "verify:office-real", dir: run.dir }));
process.exit(EXIT_BY_VERDICT[manifest.verdict] ?? 1);
