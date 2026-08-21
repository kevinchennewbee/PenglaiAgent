import assert from "node:assert/strict";
import test from "node:test";
import { apply, name, version } from "./index.js";

test("P51-SUPPLY pilot plugin is inert JS with a fixed echo", async () => {
  const calls: unknown[] = [];
  const result = apply({ tools: { register: (definition) => calls.push(definition) } });
  assert.equal(name, "@penglai/plugin-pilot");
  assert.equal(version, "1.0.0");
  assert.equal(result.version, "1.0.0");
  const tool = calls[0] as { name: string; execute: () => Promise<unknown> };
  assert.equal(tool.name, "penglai_pilot_echo");
  assert.deepEqual(await tool.execute(), { token: "penglai-pilot-ok", nativeCode: false, network: false });
});
