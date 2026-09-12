import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

type ClientExports = {
  applyLocalFeedback(context: unknown): unknown;
  LOCAL_FEEDBACK_HINT: Readonly<Record<string, string>>;
};

function loadClient(): ClientExports {
  const source = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  let factory: ((require: (name: string) => unknown) => ClientExports) | undefined;
  runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load(entry: { factory: typeof factory }) {
          factory = entry.factory;
        },
      },
    },
  });
  assert.ok(factory);
  const officialFeedbackClient = {
    apply(context: {
      effect(callback: () => unknown): unknown;
      locale: { register(namespace: string, dictionaries: unknown): unknown };
    }) {
      return context.effect(() =>
        context.locale.register("feedback", {
          zh: { "dialog.hint": "提交内容会包括当前对话的日志" },
          en: { "dialog.hint": "Your submission will include the current conversation log." },
        }),
      );
    },
  };
  return factory((name) => {
    if (name === "@deepseek-ai/dsh-client-ui-message-feedback/client") {
      return officialFeedbackClient;
    }
    return {};
  });
}

test("0.6.2 keeps official feedback behavior but registers truthful local-only copy", () => {
  const client = loadClient();
  let registered: { namespace: string; dictionaries: Record<string, Record<string, string>> } | undefined;
  const context = {
    effect(callback: () => unknown) {
      return callback();
    },
    locale: {
      register(namespace: string, dictionaries: Record<string, Record<string, string>>) {
        registered = { namespace, dictionaries };
      },
    },
  };

  client.applyLocalFeedback(context);

  assert.equal(registered?.namespace, "feedback");
  assert.equal(registered?.dictionaries.zh["dialog.hint"], client.LOCAL_FEEDBACK_HINT.zh);
  assert.equal(registered?.dictionaries.en["dialog.hint"], client.LOCAL_FEEDBACK_HINT.en);
  assert.doesNotMatch(JSON.stringify(registered), /include the current conversation log|包括当前对话的日志/);
});

test("0.6.2 disables the duplicate official row and injects it only through Plugin Center", () => {
  const patch = readFileSync(
    new URL("../../../profile-seed/web/cordis.patch.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    patch,
    /id: ui-message-feedback\n\s+name: "@deepseek-ai\/dsh-client-ui-message-feedback"\n\s+disabled: true/,
  );

  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { dsh: { client: { inject: string[] } } };
  assert.equal(
    manifest.dsh.client.inject.filter(
      (name) => name === "@deepseek-ai/dsh-client-ui-message-feedback",
    ).length,
    1,
  );
});
