import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeHttpsUrl, parsePluginLinks } from "./safe-https.js";

test("R56-UPD-007 / UF-04 plugin links allow only https without credentials or localhost", () => {
  assert.equal(assertSafeHttpsUrl("https://github.com/kevinchennewbee/PenglaiAgent").hostname, "github.com");
  assert.throws(() => assertSafeHttpsUrl("http://github.com/x"), /https/);
  assert.throws(() => assertSafeHttpsUrl("https://user:pass@github.com/x"), /credentials/);
  assert.throws(() => assertSafeHttpsUrl("https://127.0.0.1/x"), /localhost|IP/);
  assert.throws(() => assertSafeHttpsUrl("https://localhost/x"), /localhost/);
  assert.throws(() => assertSafeHttpsUrl("https://8.8.8.8/x"), /IP/);
  assert.throws(() => parsePluginLinks({ repository: "javascript:alert(1)" }), /https/);
  const links = parsePluginLinks({
    repository: "https://github.com/kevinchennewbee/PenglaiAgent",
    issues: "https://github.com/kevinchennewbee/PenglaiAgent/issues",
  });
  assert.equal(links?.repository?.startsWith("https://github.com/"), true);
});
