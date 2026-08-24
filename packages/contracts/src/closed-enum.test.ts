import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PenglaiError } from "./errors.js";
import { assertSha256, parseClosedEnum } from "./closed-enum.js";

test("R56-SEC-009 unknown enum values fail closed instead of defaulting", () => {
  const allowed = ["private", "group"] as const;
  assert.equal(parseClosedEnum("private", allowed, "CHAT_TYPE"), "private");
  assert.throws(
    () => parseClosedEnum("enabled", allowed, "CHAT_TYPE"),
    (error: unknown) =>
      error instanceof PenglaiError && error.errorClass === "STORE_CORRUPT" && error.message === "UNKNOWN_CHAT_TYPE",
  );
  assert.throws(() => parseClosedEnum(undefined, allowed, "CHAT_TYPE"), /UNKNOWN_CHAT_TYPE/);
});

test("R56-SEC-013 send digest is computed from actual bytes", () => {
  const bytes = Buffer.from("artifact-bytes");
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(assertSha256(bytes, `sha256:${digest}`), digest);
  assert.throws(
    () => assertSha256(bytes, "a".repeat(64)),
    (error: unknown) =>
      error instanceof PenglaiError && error.message === "SEND_ARTIFACT_DIGEST_MISMATCH",
  );
});
