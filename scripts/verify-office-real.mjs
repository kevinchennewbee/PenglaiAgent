import { existsSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/repo.mjs";
import { EXIT_BY_VERDICT } from "./lib/exit-contract.mjs";
import { beginEvidenceRun, finishEvidenceRun, recordCommand, HOST_TARGET } from "./lib/evidence-dir.mjs";
import { createDocument, inspect } from "../packages/office/src/service.ts";

const run = beginEvidenceRun({ command: "verify:office-real", target: HOST_TARGET });
const soffice = spawnSync("which", ["soffice"], { encoding: "utf8" });
const pdftotext = spawnSync("which", ["pdftotext"], { encoding: "utf8" });
const pdfinfo = spawnSync("which", ["pdfinfo"], { encoding: "utf8" });
recordCommand(run, { argv: ["which", "soffice"], exitCode: soffice.status, stdout: soffice.stdout, stderr: soffice.stderr });
recordCommand(run, { argv: ["which", "pdftotext"], exitCode: pdftotext.status, stdout: pdftotext.stdout, stderr: pdftotext.stderr });

const pkg = JSON.parse(readFileSync(join(ROOT, "packages/office/package.json"), "utf8"));
if (/univerjs-pro|dsh-univer-office/.test(JSON.stringify(pkg))) {
  const manifest = finishEvidenceRun(run, "FAIL", "Univer Pro forbidden");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

const dir = mkdtempSync(join(tmpdir(), "penglai-office-real-"));
const created = await createDocument("pdf", "Penglai Office PDF probe");
const pdfPath = join(dir, "probe.pdf");
writeFileSync(pdfPath, created.bytes);
const seen = await inspect(created.bytes);
if (seen.format !== "pdf") {
  const manifest = finishEvidenceRun(run, "FAIL", "created PDF did not inspect as pdf");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

if (pdfinfo.status !== 0 || pdftotext.status !== 0) {
  const manifest = finishEvidenceRun(run, "INCOMPLETE", "Poppler pdfinfo/pdftotext missing; cannot independently verify PDF");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason, dir: run.dir }));
  process.exit(EXIT_BY_VERDICT.INCOMPLETE);
}

const info = spawnSync(pdfinfo.stdout.trim(), [pdfPath], { encoding: "utf8" });
recordCommand(run, { argv: [pdfinfo.stdout.trim(), pdfPath], exitCode: info.status, stdout: info.stdout, stderr: info.stderr });
if (info.status !== 0) {
  const manifest = finishEvidenceRun(run, "FAIL", "pdfinfo rejected office PDF", { stderr: info.stderr });
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}
const textPath = join(dir, "probe.txt");
const text = spawnSync(pdftotext.stdout.trim(), [pdfPath, textPath], { encoding: "utf8" });
recordCommand(run, { argv: [pdftotext.stdout.trim(), pdfPath, textPath], exitCode: text.status, stdout: text.stdout, stderr: text.stderr });
if (text.status !== 0) {
  const manifest = finishEvidenceRun(run, "FAIL", "pdftotext rejected office PDF");
  console.error(JSON.stringify({ verdict: manifest.verdict, reason: manifest.reason }));
  process.exit(EXIT_BY_VERDICT.FAIL);
}

if (soffice.status !== 0) {
  const manifest = finishEvidenceRun(
    run,
    "INCOMPLETE",
    "LibreOffice soffice missing; DOCX/XLSX/PPTX independent verification NOT_RUN on this host. PDF Poppler checks passed.",
    { pdfinfo: info.stdout, poppler: "PASS", libreoffice: "NOT_RUN" },
  );
  console.error(JSON.stringify({ verdict: manifest.verdict, command: "verify:office-real", reason: manifest.reason, dir: run.dir }));
  process.exit(EXIT_BY_VERDICT.INCOMPLETE);
}

const manifest = finishEvidenceRun(run, "PASS", "LibreOffice and Poppler accepted office artifacts");
console.log(JSON.stringify({ verdict: manifest.verdict, command: "verify:office-real", dir: run.dir }));
process.exit(EXIT_BY_VERDICT[manifest.verdict] ?? 1);
