import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const VERIFY = path.join(ROOT, "packages/host/scripts/verify-runtime.mjs");
const VERSION = "0.4.0";
const TARGET = "test-runtime-target";

let runtimeRoot: string;
let manifestPath: string;
let pristineManifest: Record<string, unknown>;

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function verify(...extra: string[]) {
  return spawnSync(
    process.execPath,
    [
      VERIFY,
      "--runtime",
      runtimeRoot,
      "--no-boot",
      "--no-doctor",
      "--version",
      VERSION,
      "--target",
      TARGET,
      ...extra,
    ],
    { encoding: "utf-8" },
  );
}

function restoreManifest(): void {
  fs.writeFileSync(manifestPath, `${JSON.stringify(pristineManifest, null, 2)}\n`);
}

beforeAll(() => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-runtime-integrity-"));
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  const nodePath = path.join(runtimeRoot, "bin", nodeName);
  const entryPath = path.join(runtimeRoot, "src", "cli.js");
  const corePackage = path.join(runtimeRoot, "node_modules", "fixture-core", "package.json");
  const voicePackage = path.join(runtimeRoot, "node_modules", "fixture-voice", "package.json");
  fs.mkdirSync(path.dirname(nodePath), { recursive: true });
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.mkdirSync(path.dirname(corePackage), { recursive: true });
  fs.mkdirSync(path.dirname(voicePackage), { recursive: true });
  if (process.platform === "win32") {
    fs.copyFileSync(process.execPath, nodePath);
  } else {
    // The Node binary running the test may depend on a sibling libnode
    // (for example the bundled Codex runtime). Copying that executable by
    // itself produces a fixture that fails before the manifest verifier can
    // exercise the behavior under test. A tiny executable version probe keeps
    // this unit test independent from the developer's Node distribution; the
    // real packaged runtime is exercised separately by runtime:verify.
    fs.writeFileSync(
      nodePath,
      `#!/bin/sh\nprintf '%s\\n' '${process.version}'\n`,
      { mode: 0o755 },
    );
  }
  fs.writeFileSync(entryPath, "export {};\n");
  fs.writeFileSync(corePackage, '{"name":"fixture-core"}\n');
  fs.writeFileSync(voicePackage, '{"name":"fixture-voice"}\n');
  const files = [nodePath, entryPath, corePackage, voicePackage].map((file) => ({
    path: path.relative(runtimeRoot, file).split(path.sep).join("/"),
    sha256: sha256(file),
    size: fs.statSync(file).size,
  }));
  pristineManifest = {
    schemaVersion: 2,
    productVersion: VERSION,
    runtimeVersion: VERSION,
    target: TARGET,
    entry: "src/cli.js",
    node: {
      path: `bin/${nodeName}`,
      version: process.version.replace(/^v/, ""),
      sha256: sha256(nodePath),
    },
    requiredPackages: ["fixture-core"],
    requiredVoiceEngines: ["fixture-voice"],
    fileCount: files.length,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    files,
  };
  manifestPath = path.join(runtimeRoot, "manifest.json");
  restoreManifest();
});

afterAll(() => {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

describe("runtime manifest integrity gate", () => {
  it("accepts an exact, versioned and target-bound payload set", () => {
    const result = verify();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("[verify] PASS manifest");
  });

  it("rejects files that are absent from the signed manifest", () => {
    const extra = path.join(runtimeRoot, "untracked.js");
    fs.writeFileSync(extra, "unexpected\n");
    try {
      const result = verify();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("untracked runtime payload");
    } finally {
      fs.rmSync(extra, { force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinks even when they point at a tracked payload",
    () => {
      const link = path.join(runtimeRoot, "payload-link");
      fs.symlinkSync("src/cli.js", link);
      try {
        const result = verify();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("must not contain symlinks");
      } finally {
        fs.rmSync(link, { force: true });
      }
    },
  );

  it("rejects duplicate manifest aliases", () => {
    const forged = structuredClone(pristineManifest) as {
      files: Array<{ path: string; sha256: string; size: number }>;
      fileCount: number;
      totalSize: number;
    };
    forged.files.push({ ...forged.files[0] });
    forged.fileCount = forged.files.length;
    forged.totalSize += forged.files[0].size;
    fs.writeFileSync(manifestPath, `${JSON.stringify(forged, null, 2)}\n`);
    try {
      const result = verify();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("duplicate runtime manifest path");
    } finally {
      restoreManifest();
    }
  });

  it("rejects a build for the wrong release version or target", () => {
    const wrongVersion = verify("--version", "0.4.1");
    expect(wrongVersion.status).not.toBe(0);
    expect(wrongVersion.stderr).toContain("runtime version mismatch");

    const wrongTarget = verify("--target", "wrong-target");
    expect(wrongTarget.status).not.toBe(0);
    expect(wrongTarget.stderr).toContain("runtime target mismatch");
  });

  it("rejects a manifest that promises a voice engine absent from the payload", () => {
    const forged = structuredClone(pristineManifest) as Record<string, unknown>;
    forged.requiredVoiceEngines = ["sherpa-onnx"];
    fs.writeFileSync(manifestPath, `${JSON.stringify(forged, null, 2)}\n`);
    try {
      const result = verify();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("required runtime package is missing: sherpa-onnx");
    } finally {
      restoreManifest();
    }
  });
});
