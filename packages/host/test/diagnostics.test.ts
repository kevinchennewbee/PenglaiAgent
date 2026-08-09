import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { exportDiagnostics, sanitizeDiagnosticText } from "../src/diagnostics.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("diagnostic export", () => {
  it("redacts credential-shaped values and home paths", () => {
    const result = sanitizeDiagnosticText(
      'Authorization: Bearer abc.def\napi_key=super-secret\n{"token":"xyz"}\n/example-home/project',
      "/example-home",
    );
    expect(result.text).not.toContain("abc.def");
    expect(result.text).not.toContain("super-secret");
    expect(result.text).not.toContain('"xyz"');
    expect(result.text).not.toContain("/example-home");
    expect(result.redactions).toBeGreaterThanOrEqual(4);
  });

  it("exports only bounded text logs and never product state", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-diagnostics-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "logs"), { recursive: true });
    fs.mkdirSync(path.join(root, "conversations"), { recursive: true });
    fs.writeFileSync(path.join(root, "logs", "host.log"), "Bearer live-token\npassword=hunter2\nok\n");
    fs.writeFileSync(path.join(root, "logs", "ignore.bin"), "not a log");
    fs.writeFileSync(path.join(root, "host.token"), "must-never-ship");
    fs.writeFileSync(path.join(root, "profiles.json"), '{"apiKey":"must-never-ship"}');
    fs.writeFileSync(path.join(root, "product.db"), "must-never-ship");
    fs.writeFileSync(path.join(root, "conversations", "secret.jsonl"), "must-never-ship");

    const result = await exportDiagnostics({
      dataDir: root,
      doctorResults: [{ check: "token", status: "ok", message: `present at ${os.homedir()}/.penglai/host.token` }],
      now: () => new Date("2026-08-09T12:00:00.000Z"),
      randomId: () => "fixed",
    });
    expect(result.includedLogs).toBe(1);
    expect(result.redactions).toBeGreaterThanOrEqual(2);
    expect(fs.statSync(result.path).mode & 0o777).toBe(0o600);

    const entries = unzipSync(fs.readFileSync(result.path));
    expect(Object.keys(entries).sort()).toEqual([
      "about.json",
      "doctor.json",
      "logs/host.log",
      "manifest.json",
    ]);
    const combined = Object.values(entries).map((value) => strFromU8(value)).join("\n");
    expect(combined).not.toContain("live-token");
    expect(combined).not.toContain("hunter2");
    expect(combined).not.toContain("must-never-ship");
    expect(combined).not.toContain(os.homedir());
    expect(combined).toContain("[REDACTED]");
  });
});
