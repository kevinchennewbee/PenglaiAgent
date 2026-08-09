import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SH_INSTALLER = path.join(ROOT, "install.sh");
const PS_INSTALLER = path.join(ROOT, "install.ps1");

describe("0.4 installer cutover", () => {
  it("keeps both main-branch legacy bootstraps fail closed", () => {
    const shell = fs.readFileSync(SH_INSTALLER, "utf-8");
    const powershell = fs.readFileSync(PS_INSTALLER, "utf-8");
    for (const source of [shell, powershell]) {
      expect(source).toContain("v0.3.6");
      expect(source).toContain("releases");
      expect(source).toMatch(/exit 64/i);
      expect(source).not.toMatch(/\buv\s+(?:venv|pip)|pip install|agent_loop\.py/);
    }
  });

  it.skipIf(process.platform === "win32")(
    "the POSIX entry point exits before changing the machine",
    () => {
      const result = spawnSync("/bin/sh", [SH_INSTALLER], {
        encoding: "utf-8",
        cwd: ROOT,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      });
      expect(result.status).toBe(64);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("legacy Python bootstrap");
      expect(result.stderr).toContain("SHA-256");
    },
  );
});
