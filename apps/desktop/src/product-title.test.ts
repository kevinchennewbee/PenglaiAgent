import assert from "node:assert/strict";
import test from "node:test";
import {
  installPenglaiDocumentTitle,
  penglaiDocumentTitle,
} from "./product-title.js";

test("desktop title replaces only the upstream product identity", () => {
  assert.equal(penglaiDocumentTitle(""), "蓬莱 Penglai");
  assert.equal(penglaiDocumentTitle("DeepSeek Harness"), "蓬莱 Penglai");
  assert.equal(
    penglaiDocumentTitle("Research — DeepSeek Harness"),
    "Research — 蓬莱 Penglai",
  );
  assert.equal(penglaiDocumentTitle("Research"), "Research");
});

test("desktop preload restores the title after upstream updates", () => {
  let mutation: (() => void) | undefined;
  let disconnected = false;
  const head = {} as Node;
  const documentPort = {
    title: "DeepSeek Harness",
    head,
    documentElement: {} as Node,
  };
  class Observer {
    constructor(callback: () => void) {
      mutation = callback;
    }
    observe(target: Node, options: MutationObserverInit) {
      assert.equal(target, head);
      assert.deepEqual(options, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    disconnect() {
      disconnected = true;
    }
  }

  const dispose = installPenglaiDocumentTitle(documentPort, Observer);
  assert.equal(documentPort.title, "蓬莱 Penglai");
  documentPort.title = "Session — DeepSeek Harness";
  mutation?.();
  assert.equal(documentPort.title, "Session — 蓬莱 Penglai");
  dispose();
  assert.equal(disconnected, true);
});
