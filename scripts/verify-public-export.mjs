import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";
import { finish } from "./lib/exit-contract.mjs";

const pe = await import(pathToFileURL(join(ROOT, "packages/release-identity/src/index.ts")).href);
const path = join(ROOT, "evidence/generated/public-export.json");
const manifestPath = join(ROOT, "evidence/generated/public-export-manifest.json");
if (!existsSync(path) || !existsSync(manifestPath)) {
  finish("INCOMPLETE", { command: "verify:public-export", reason: "public-export not generated" });
}
const rec = JSON.parse(readFileSync(path, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!rec.publicExportTreeSha256 || rec.publicExportTreeSha256 !== manifest.publicExportTreeSha256) {
  finish("FAIL", { command: "verify:public-export", reason: "missing or mismatched publicExportTreeSha256" });
}
if (rec.publicationExecuted === true) {
  finish("FAIL", { command: "verify:public-export", reason: "export manifest must be frozen before external publication" });
}
try {
  pe.assertPublicationTarget(rec.publication ?? {});
} catch (err) {
  finish("FAIL", { command: "verify:public-export", reason: String(err) });
}
const files = Array.isArray(manifest.files) ? manifest.files : [];
const paths = files.map((f) => f.path);
try {
  pe.assertRequiredPublicDocs(paths);
  pe.assertExportHasSourceNotOnlyBinary(paths);
} catch (err) {
  finish("FAIL", { command: "verify:public-export", reason: String(err) });
}
const denied = paths.filter((p) => !pe.pathAllowed(p));
if (denied.length) {
  finish("FAIL", { command: "verify:public-export", reason: "denied path leaked into export", denied: denied.slice(0, 10) });
}
const incompleteFields = files.filter((f) => !f.path || !f.mode || !f.sha256 || !f.license || typeof f.size !== "number");
if (incompleteFields.length) {
  finish("FAIL", { command: "verify:public-export", reason: "export manifest missing path/mode/size/hash/license" });
}
if (rec.cleanRoom?.executed !== true || rec.cleanRoom?.installStatus !== 0 || rec.cleanRoom?.typecheckStatus !== 0) {
  finish("INCOMPLETE", {
    command: "verify:public-export",
    reason: "public-export tree/docs/scan gates passed; clean-room lock-only install not executed",
    publicExportTreeSha256: rec.publicExportTreeSha256,
    files: rec.files,
  });
}
const git = (await import("./lib/repo.mjs")).gitState();
if (rec.privateCandidateSourceSha && rec.privateCandidateSourceSha !== git.head) {
  finish("INCOMPLETE", {
    command: "verify:public-export",
    reason: "public-export tree is not bound to current HEAD; regenerate after feature freeze",
    publicExportTreeSha256: rec.publicExportTreeSha256,
  });
}
const bound = pe.bindArtifactFreshness({
  candidateSha: git.head,
  exportSourceSha: rec.privateCandidateSourceSha,
  exportDirty: rec.treeDirty === true,
});
if (!bound.ok) {
  finish(bound.verdict, { command: "verify:public-export", reason: bound.reason, treeDirty: rec.treeDirty });
}
finish("PASS", { command: "verify:public-export", publicExportTreeSha256: rec.publicExportTreeSha256, files: rec.files });
