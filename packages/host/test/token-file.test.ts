import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectHostTokenFile,
  loadOrCreateHostToken,
  readAndHardenHostToken,
} from "../src/token-file.js";

const roots: string[] = [];

function temporaryDataDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-token-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe("Host token file", () => {
  it("creates a strong credential with private permissions", () => {
    const dataDir = temporaryDataDir();
    const token = loadOrCreateHostToken(dataDir);
    const file = path.join(dataDir, "host.token");

    expect(token).toMatch(/^[a-f0-9]{48}$/);
    expect(fs.readFileSync(file, "utf-8").trim()).toBe(token);
    if (process.platform !== "win32") {
      expect(fs.statSync(dataDir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(inspectHostTokenFile(dataDir).ok).toBe(true);
  });

  it("hardens an existing credential before returning it", () => {
    const dataDir = temporaryDataDir();
    const file = path.join(dataDir, "host.token");
    const token = "a".repeat(48);
    fs.writeFileSync(file, `${token}\n`, { mode: 0o644 });

    expect(readAndHardenHostToken(dataDir)).toBe(token);
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects weak or malformed credential files", () => {
    const shortDir = temporaryDataDir();
    fs.writeFileSync(path.join(shortDir, "host.token"), "short\n");
    expect(() => readAndHardenHostToken(shortDir)).toThrow(/too short/);
    expect(inspectHostTokenFile(shortDir).ok).toBe(false);

    if (process.platform !== "win32") {
      const symlinkDir = temporaryDataDir();
      const target = path.join(symlinkDir, "elsewhere");
      fs.writeFileSync(target, "b".repeat(48));
      fs.symlinkSync(target, path.join(symlinkDir, "host.token"));
      expect(() => readAndHardenHostToken(symlinkDir)).toThrow(/regular file/);
      expect(inspectHostTokenFile(symlinkDir).ok).toBe(false);
    }
  });
});
