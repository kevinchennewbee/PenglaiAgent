import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SH_INSTALLER = path.join(ROOT, "install.sh");
const PS_INSTALLER = path.join(ROOT, "install.ps1");
const HOST_SH_INSTALLER = path.join(ROOT, "packages/host/scripts/install.sh");
const HOST_PS_INSTALLER = path.join(ROOT, "packages/host/scripts/install.ps1");

describe("0.4 installer cutover", () => {
  it("does not publish the 0.3 POSIX bootstrap on main", () => {
    expect(fs.existsSync(SH_INSTALLER)).toBe(false);
  });

  it("does not publish the 0.3 PowerShell bootstrap on main", () => {
    expect(fs.existsSync(PS_INSTALLER)).toBe(false);
  });

  it("keeps both 0.4 Host installers production-only and exposes the canonical command", () => {
    const shell = fs.readFileSync(HOST_SH_INSTALLER, "utf-8");
    const powershell = fs.readFileSync(HOST_PS_INSTALLER, "utf-8");
    for (const source of [shell, powershell]) {
      expect(source).toMatch(/production runtime|production execution|\u751f\u4ea7\u8fd0\u884c\u65f6/i);
      expect(source).toContain("penglai");
      expect(source).not.toMatch(/node --import tsx|\u6539\u7528 tsx|best-effort.*fall back/i);
      expect(source).not.toMatch(/curl[^\n]*\|\s*(?:sh|bash)|Invoke-Expression|\biex\b/i);
    }
    expect(shell).toContain('"$BIN_DIR/penglai"');
    expect(powershell).toContain('"penglai.cmd"');
    expect(powershell).not.toContain("winget install");
  });
});
