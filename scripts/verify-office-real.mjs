import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";
import { EXIT_BY_VERDICT } from "./lib/exit-contract.mjs";
import { beginEvidenceRun, finishEvidenceRun, recordCommand, recordArtifact, HOST_TARGET } from "./lib/evidence-dir.mjs";
import { createDocument, edit, inspect } from "../packages/office/src/service.ts";

const run = beginEvidenceRun({ command: "verify:office-real", target: HOST_TARGET });
const soffice = spawnSync("which", ["soffice"], { encoding: "utf8" });
const pdftotext = spawnSync("which", ["pdftotext"], { encoding: "utf8" });
const pdfinfo = spawnSync("which", ["pdfinfo"], { encoding: "utf8" });
recordCommand(run, { argv: ["which", "soffice"], exitCode: soffice.status, stdout: soffice.stdout, stderr: soffice.stderr });
recordCommand(run, { argv: ["which", "pdftotext"], exitCode: pdftotext.status, stdout: pdftotext.stdout, stderr: pdftotext.stderr });
recordCommand(run, { argv: ["which", "pdfinfo"], exitCode: pdfinfo.status, stdout: pdfinfo.stdout, stderr: pdfinfo.stderr });

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

let poppler = "NOT_RUN";
if (pdfinfo.status === 0 && pdftotext.status === 0) {
  const infoBin = pdfinfo.stdout.trim();
  const textBin = pdftotext.stdout.trim();
  const info = spawnSync(infoBin, [paths.pdf], { encoding: "utf8" });
  recordCommand(run, { argv: [infoBin, paths.pdf], exitCode: info.status, stdout: info.stdout, stderr: info.stderr });
  if (info.status !== 0) {
    const manifest = finishEvidenceRun(run, "FAIL", "pdfinfo rejected office PDF", { stderr: info.stderr });
    console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
    process.exit(EXIT_BY_VERDICT.FAIL);
  }
  const textPath = join(dir, "pdf-probe.txt");
  const text = spawnSync(textBin, [paths.pdf, textPath], { encoding: "utf8" });
  recordCommand(run, { argv: [textBin, paths.pdf, textPath], exitCode: text.status, stdout: text.stdout, stderr: text.stderr });
  if (text.status !== 0) {
    const manifest = finishEvidenceRun(run, "FAIL", "pdftotext rejected office PDF");
    console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
    process.exit(EXIT_BY_VERDICT.FAIL);
  }
  const extracted = readFileSync(textPath, "utf8");
  const normalizedExtracted = extracted.replace(/\s+/g, " ").trim();
  if (!normalizedExtracted.includes(arbitraryChinese) || !normalizedExtracted.includes("蓬莱水印")) {
    const manifest = finishEvidenceRun(run, "FAIL", "pdftotext did not read CJK PDF text", { extracted });
    console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
    process.exit(EXIT_BY_VERDICT.FAIL);
  }
  poppler = "PASS";
} else {
  const manifest = finishEvidenceRun(run, "INCOMPLETE", "Poppler pdfinfo/pdftotext missing; cannot independently verify PDF");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason, dir: run.dir }));
  process.exit(EXIT_BY_VERDICT.INCOMPLETE);
}

if (soffice.status !== 0) {
  const manifest = finishEvidenceRun(
    run,
    "INCOMPLETE",
    "LibreOffice soffice missing; DOCX/XLSX/PPTX independent verification NOT_RUN on this host. PDF Poppler checks passed. Fixtures were produced by Penglai engines, not Microsoft Office.",
    { poppler, libreoffice: "NOT_RUN", fixtureOrigin: "penglai-office-engine" },
  );
  console.error(JSON.stringify({ verdict: manifest.verdict, command: "verify:office-real", reason: manifest.reason, dir: run.dir }));
  process.exit(EXIT_BY_VERDICT.INCOMPLETE);
}

const sofficeBin = soffice.stdout.trim();
const convertDir = join(dir, "lo");
mkdirSync(convertDir, { recursive: true, mode: 0o700 });
const convert = spawnSync(
  sofficeBin,
  ["--headless", "--convert-to", "pdf", "--outdir", convertDir, paths.docx, paths.xlsx, paths.pptx],
  { encoding: "utf8", timeout: 120000 },
);
recordCommand(run, {
  argv: [sofficeBin, "--headless", "--convert-to", "pdf", paths.docx, paths.xlsx, paths.pptx],
  exitCode: convert.status,
  stdout: convert.stdout,
  stderr: convert.stderr,
});
if (convert.status !== 0) {
  const manifest = finishEvidenceRun(run, "FAIL", "LibreOffice rejected OOXML artifacts", { stderr: convert.stderr });
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}
const loPdfs = ["docx-probe.pdf", "xlsx-probe.pdf", "pptx-probe.pdf"].map((name) => join(convertDir, name));
for (const pdfPath of loPdfs) {
  if (!existsSync(pdfPath) || readFileSync(pdfPath).length === 0) {
    const manifest = finishEvidenceRun(run, "FAIL", `LibreOffice did not emit ${pdfPath}`);
    console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
    process.exit(EXIT_BY_VERDICT.FAIL);
  }
  recordArtifact(run, pdfPath, "application/pdf");
}

const manifest = finishEvidenceRun(run, "PASS", "LibreOffice and Poppler accepted office artifacts", {
  poppler,
  libreoffice: "PASS",
  fixtureOrigin: "penglai-office-engine",
});
console.log(JSON.stringify({ verdict: manifest.verdict, command: "verify:office-real", dir: run.dir }));
process.exit(EXIT_BY_VERDICT[manifest.verdict] ?? 1);
