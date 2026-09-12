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
  return factory((name) => {
    if (name === "@deepseek-ai/dsh-client-ui-message-feedback/client") {
      throw new Error("Plugin Center must not load another plugin's client module");
    }
    return {};
  });
}

test("0.6.2 lets the enabled official feedback client register truthful local-only copy", () => {
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

  const dispose = client.applyLocalFeedback(context) as () => void;
  context.locale.register("feedback", {
    zh: { "dialog.hint": "提交内容会包括当前对话的日志" },
    en: { "dialog.hint": "Your submission will include the current conversation log." },
  });

  assert.equal(registered?.namespace, "feedback");
  assert.equal(registered?.dictionaries.zh["dialog.hint"], client.LOCAL_FEEDBACK_HINT.zh);
  assert.equal(registered?.dictionaries.en["dialog.hint"], client.LOCAL_FEEDBACK_HINT.en);
  assert.doesNotMatch(JSON.stringify(registered), /include the current conversation log|包括当前对话的日志/);
  assert.equal(dispose(), undefined);
});

test("0.6.2 enables exactly one official feedback row without Plugin Center injection", () => {
  const patch = readFileSync(
    new URL("../../../profile-seed/web/cordis.patch.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    patch,
    /id: ui-message-feedback\r?\n\s+name: "@deepseek-ai\/dsh-client-ui-message-feedback"(?:\r?\n|$)/,
  );
  assert.doesNotMatch(
    patch,
    /id: ui-message-feedback\r?\n\s+name: "@deepseek-ai\/dsh-client-ui-message-feedback"\r?\n\s+disabled: true/,
  );

  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { dsh: { client: { inject: string[] } } };
  assert.equal(manifest.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-message-feedback"), false);
});

test("renderer and Electron Main agree that confirmUpdate takes no renderer authority", () => {
  const client = readFileSync(new URL("./dsh-client.js", import.meta.url), "utf8");
  const main = readFileSync(
    new URL("../../../apps/desktop/src/electron-main.ts", import.meta.url),
    "utf8",
  );
  assert.match(client, /run\("confirmUpdate"\)/);
  assert.doesNotMatch(client, /run\("confirmUpdate",\s*\{\s*confirmed:/);
  const handler = main.slice(main.indexOf('if (name === "confirmUpdate")'), main.indexOf('if (name === "getUninstallState")'));
  assert.match(handler, /requireNoArguments\(args\)/);
  assert.match(handler, /dialog\.showMessageBox/);
});
