import assert from "node:assert/strict";
import test from "node:test";
import {
  HARNESS_IDENTITY_NAME,
  PENGLAI_IDENTITY_NAME,
  PENGLAI_PRODUCT_IDENTITY,
  applyPenglaiProductIdentity,
  installPenglaiProductIdentity,
} from "./identity.js";

test("Penglai identity replaces the official DeepSeek Harness opener", () => {
  const next = applyPenglaiProductIdentity({
    sections: [
      { name: HARNESS_IDENTITY_NAME, text: "You are an AI agent powered by DeepSeek Harness." },
      { name: "tool:bash", text: "Use bash only when asked." },
    ],
    tools: [{ name: "bash" }],
    variables: { model: "deepseek-chat" },
  }) as {
    sections: Array<{ name: string; text: string }>;
    tools: Array<{ name: string }>;
    variables: { model: string };
  };
  assert.equal(next.sections[0]?.name, HARNESS_IDENTITY_NAME);
  assert.equal(next.sections[0]?.text, PENGLAI_PRODUCT_IDENTITY);
  assert.match(next.sections[0]?.text ?? "", /蓬莱 Penglai/);
  assert.doesNotMatch(next.sections[0]?.text ?? "", /You are an AI agent powered by DeepSeek Harness/);
  assert.doesNotMatch(next.sections[0]?.text ?? "", /The runtime is official DeepSeek Harness/);
  assert.equal(next.sections[1]?.name, "tool:bash");
  assert.deepEqual(next.tools, [{ name: "bash" }]);
  assert.equal(next.variables.model, "deepseek-chat");
});

test("Penglai identity prepends when harness identity is omitted", () => {
  const next = applyPenglaiProductIdentity({
    sections: [{ name: "deployment:persona", text: "" }],
  }) as { sections: Array<{ name: string; text?: string }> };
  assert.equal(next.sections[0]?.name, PENGLAI_IDENTITY_NAME);
  assert.equal(next.sections[0]?.text, PENGLAI_PRODUCT_IDENTITY);
  assert.equal(next.sections[1]?.name, "deployment:persona");
});

test("Penglai identity does not invent a complete prompt or drop tools", () => {
  const next = applyPenglaiProductIdentity({
    sections: [{ name: HARNESS_IDENTITY_NAME, text: "You are an AI agent powered by DeepSeek Harness.", complete: true }],
    tools: [{ name: "read" }],
  }) as { sections: Array<{ complete?: boolean }>; tools: unknown };
  assert.equal(next.sections[0]?.complete, true);
  assert.deepEqual(next.tools, [{ name: "read" }]);
  assert.doesNotMatch(PENGLAI_PRODUCT_IDENTITY, /\{\{/);
});

test("installPenglaiProductIdentity listens on the official assemble waterfall", async () => {
  const listeners: Array<(...args: unknown[]) => unknown> = [];
  installPenglaiProductIdentity({
    on(event, fn) {
      assert.equal(event, "system-prompt/assemble");
      listeners.push(fn as (...args: unknown[]) => unknown);
      return () => {
        listeners.length = 0;
      };
    },
    effect(setup) {
      setup();
    },
  });
  assert.equal(listeners.length, 1);
  const assembled = await listeners[0]!(
    { sections: [{ name: HARNESS_IDENTITY_NAME, text: "You are an AI agent powered by DeepSeek Harness." }] },
    {},
    async () => ({
      sections: [{ name: HARNESS_IDENTITY_NAME, text: "You are an AI agent powered by DeepSeek Harness." }],
      tools: [],
    }),
  );
  assert.equal(
    (assembled as { sections: Array<{ text: string }> }).sections[0]?.text,
    PENGLAI_PRODUCT_IDENTITY,
  );
});

test("Penglai identity fills official persona model/cwd or drops unresolved placeholders", () => {
  const filled = applyPenglaiProductIdentity(
    {
      sections: [
        { name: HARNESS_IDENTITY_NAME, text: "You are an AI agent powered by DeepSeek Harness." },
        { name: "deployment:persona", text: "You are a coding agent powered by the {{model}} model." },
      ],
      variables: { model: undefined, cwd: undefined },
    },
    { agent: { agentOptions: { model: "deepseek-v4-flash" } } },
  ) as { variables: { model?: string }; sections: Array<{ text?: string }> };
  assert.equal(filled.variables.model, "deepseek-v4-flash");
  assert.match(filled.sections[1]?.text ?? "", /\{\{model\}\}/);

  const stripped = applyPenglaiProductIdentity({
    sections: [{ name: "deployment:persona", text: "powered by the {{model}} model in {{cwd}}" }],
    variables: {},
  }) as { sections: Array<{ name?: string; text?: string }> };
  const persona = stripped.sections.find((section) => section.name === "deployment:persona");
  assert.doesNotMatch(persona?.text ?? "", /\{\{/);
});
