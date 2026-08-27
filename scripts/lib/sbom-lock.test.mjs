import assert from "node:assert/strict";
import test from "node:test";
import { collectLockPackageIds } from "./sbom-lock.mjs";

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
