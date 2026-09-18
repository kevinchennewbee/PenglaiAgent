import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the current IM production package consumes @penglai/artifacts while retired Office stays outside the workspace", () => {
  const im = JSON.parse(readFileSync(new URL("../../im/package.json", import.meta.url), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(im.dependencies["@penglai/artifacts"], "workspace:*");
  const workspace = readFileSync(new URL("../../../pnpm-workspace.yaml", import.meta.url), "utf8");
  const imApply = readFileSync(new URL("../../im/src/index.ts", import.meta.url), "utf8");
  const imHost = readFileSync(new URL("../../im/src/host.ts", import.meta.url), "utf8");
  assert.match(workspace, /!packages\/office/);
  assert.match(imApply, /new ArtifactService/);
  assert.match(imHost, /attachArtifacts/);
  assert.match(imApply, /onAdmittedBytes/);
  assert.match(imApply, /source: "im"/);
});
