import assert from "node:assert/strict";
import test from "node:test";
import { collectLockPackageIds, splitLockPackageId } from "./sbom-lock.mjs";

test("SBOM lock inventory is identical for LF and CRLF checkouts", () => {
  const lf = [
    "packages:",
    "",
    "  '@scope/alpha@1.2.3':",
    "    resolution: {integrity: sha512-example}",
    "  beta@4.5.6:",
    "    resolution: {integrity: sha512-example}",
    "",
  ].join("\n");
  assert.deepEqual(collectLockPackageIds(lf), ["'@scope/alpha@1.2.3'", "beta@4.5.6"]);
  assert.deepEqual(collectLockPackageIds(lf.replaceAll("\n", "\r\n")), collectLockPackageIds(lf));
});

test("SBOM package identity strips pnpm peer suffixes and scoped-key quotes", () => {
  assert.deepEqual(splitLockPackageId("'@scope/alpha@1.2.3'"), {
    name: "@scope/alpha",
    version: "1.2.3",
  });
  assert.deepEqual(splitLockPackageId("plain@4.5.6(peer@1.0.0)"), {
    name: "plain",
    version: "4.5.6",
  });
});
