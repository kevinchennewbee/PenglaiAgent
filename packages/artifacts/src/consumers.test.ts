import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Office and IM production packages consume @penglai/artifacts", () => {
  const office = JSON.parse(readFileSync(new URL("../../office/package.json", import.meta.url), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const im = JSON.parse(readFileSync(new URL("../../im/package.json", import.meta.url), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(office.dependencies["@penglai/artifacts"], "workspace:*");
  assert.equal(im.dependencies["@penglai/artifacts"], "workspace:*");
  const officeApply = readFileSync(new URL("../../office/src/index.ts", import.meta.url), "utf8");
  const officeService = readFileSync(new URL("../../office/src/service.ts", import.meta.url), "utf8");
  const imApply = readFileSync(new URL("../../im/src/index.ts", import.meta.url), "utf8");
  const imHost = readFileSync(new URL("../../im/src/host.ts", import.meta.url), "utf8");
  assert.match(officeApply, /new ArtifactService/);
  assert.match(officeService, /opts\?\.artifacts/);
  assert.match(imApply, /new ArtifactService/);
  assert.match(imHost, /attachArtifacts/);
  assert.match(imApply, /onAdmittedBytes/);
  assert.match(imApply, /source: "im"/);
});
