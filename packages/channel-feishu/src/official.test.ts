import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FEISHU_EVENT_MODE,
  FEISHU_MIN_SCOPES,
  FEISHU_RECEIVE_EVENT,
  PINNED_LARK_COMMIT,
  PINNED_LARK_SDK,
  isBaseBotAuth,
  isForbiddenBaseAuth,
  isOfficialAppRegistrationQr,
} from "./official.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const req = createRequire(import.meta.url);

test("R2I-FS-005 Device Flow is not base bot auth", () => {
  assert.equal(isBaseBotAuth("app_id_app_secret"), true);
  assert.equal(isForbiddenBaseAuth("device_flow"), true);
  assert.equal(isForbiddenBaseAuth("oauth"), true);
  assert.equal(isForbiddenBaseAuth("qr"), false);
  assert.equal(isOfficialAppRegistrationQr("app_registration_qr"), true);
});

test("R2I-FS-006/007/008 official SDK pin compile/run probe", () => {
  const pkg = req("@larksuiteoapi/node-sdk/package.json") as { version?: string };
  assert.equal(pkg.version, PINNED_LARK_SDK);
  const sdk = req("@larksuiteoapi/node-sdk") as {
    Client?: unknown;
    WSClient?: unknown;
    EventDispatcher?: unknown;
    default?: { Client?: unknown; WSClient?: unknown; EventDispatcher?: unknown };
  };
  const Client = sdk.Client ?? sdk.default?.Client;
  const WSClient = sdk.WSClient ?? sdk.default?.WSClient;
  const EventDispatcher = sdk.EventDispatcher ?? sdk.default?.EventDispatcher;
  assert.equal(typeof Client, "function");
  assert.equal(typeof WSClient, "function");
  assert.equal(typeof EventDispatcher, "function");
  const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  assert.match(lock, /@larksuiteoapi\/node-sdk@1\.73\.0/);
  assert.equal(FEISHU_RECEIVE_EVENT, "im.message.receive_v1");
  assert.equal(FEISHU_EVENT_MODE, "long_connection");
  assert.ok(FEISHU_MIN_SCOPES.includes("im:message.p2p_msg:readonly"));
  assert.ok(FEISHU_MIN_SCOPES.includes("im:message:send_as_bot"));
  assert.equal(PINNED_LARK_COMMIT, "f54b49f3566c52b54c598194b7ed3015e3e24224");
});

test("R2I-FS-020 no OpenClaw runtime dependency", () => {
  const pkg = JSON.parse(readFileSync(join(root, "packages/channel-feishu/package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const names = Object.keys(pkg.dependencies ?? {});
  assert.equal(names.some((n) => /openclaw/i.test(n)), false);
});
