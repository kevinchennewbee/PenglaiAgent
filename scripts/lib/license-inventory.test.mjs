import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLicense,
  collectLockIntegrities,
  integrityForPackage,
  normalizeRepository,
} from "./license-inventory.mjs";

test("license policy rejects unknown and copyleft production dependencies", () => {
  assert.throws(() => classifyLicense("mystery", "Unknown"), /unknown license/);
  assert.throws(() => classifyLicense("libsignal", "GPL-3.0"), /unapproved copyleft/);
  assert.equal(classifyLicense("jszip", "(MIT OR GPL-3.0-or-later)").effectiveLicense, "MIT");
  assert.equal(
    classifyLicense("@img/sharp-libvips-darwin-arm64", "LGPL-3.0-or-later").disposition,
    "excluded-from-release",
  );
});

test("lock integrity parser is LF/CRLF invariant and handles scoped peer keys", () => {
  const lf = [
    "packages:",
    "",
    "  '@scope/pkg@1.2.3':",
    "    resolution: {integrity: sha512-scope}",
    "  plain@4.5.6(peer@1.0.0):",
    "    resolution: {integrity: sha512-plain}",
  ].join("\n");
  const rows = collectLockIntegrities(lf);
  assert.deepEqual(rows, collectLockIntegrities(lf.replaceAll("\n", "\r\n")));
  assert.equal(integrityForPackage(rows, "@scope/pkg", "1.2.3"), "sha512-scope");
  assert.equal(integrityForPackage(rows, "plain", "4.5.6"), "sha512-plain");
  assert.equal(normalizeRepository("git+https://github.com/acme/pkg.git"), "https://github.com/acme/pkg");
});
