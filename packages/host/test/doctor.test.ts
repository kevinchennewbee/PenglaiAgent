/**
 * Doctor tests (M4).
 *
 * Validates that runDoctor() runs every check without throwing, returns the
 * expected number of results with a well-formed shape, and enforces the
 * invariant that every warn/fail result carries a suggested fix. Environment-
 * dependent statuses (port free/in-use, token present, etc.) are not asserted
 * to a single value; only structure + the deterministic node check are.
 */

import { describe, it, expect } from "vitest";
import { runDoctor, type DoctorStatus } from "../src/doctor.js";

const VALID_STATUSES: DoctorStatus[] = ["ok", "warn", "fail"];

const EXPECTED_CHECKS = [
  "node",
  "npm",
  "host-port",
  "token",
  "conversations-dir",
  "model-profile",
  "git",
  // 语音能力探测（可选 I/O 层，懒加载；warn 也带 fix）
  "voice-asr",
  "voice-tts",
];

describe("doctor: runDoctor", () => {
  it("returns a result for every supported check", async () => {
    const results = await runDoctor();
    expect(results).toHaveLength(EXPECTED_CHECKS.length);
    const names = results.map((r) => r.check);
    for (const name of EXPECTED_CHECKS) {
      expect(names).toContain(name);
    }
  });

  it("every result has a valid status and a non-empty message", async () => {
    const results = await runDoctor();
    for (const r of results) {
      expect(VALID_STATUSES).toContain(r.status);
      expect(typeof r.message).toBe("string");
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it("every warn/fail result carries a suggested fix", async () => {
    const results = await runDoctor();
    for (const r of results) {
      if (r.status !== "ok") {
        expect(typeof r.fix).toBe("string");
        expect((r.fix ?? "").length).toBeGreaterThan(0);
      }
    }
  });

  it("reports node as ok when running on Node >= 22 (test env)", async () => {
    const results = await runDoctor();
    const node = results.find((r) => r.check === "node");
    expect(node).toBeDefined();
    expect(node?.status).toBe("ok");
  });

  it("never throws and always returns an array", async () => {
    // Even with a weird port option it must not reject.
    const results = await runDoctor({ port: 1 });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });
});
