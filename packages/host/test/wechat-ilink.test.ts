import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadWechatToken,
  saveWechatToken,
  wechatTokenPath,
} from "../src/wechat/ilink.js";

const roots: string[] = [];

function temporaryDataDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-wechat-token-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("WeChat iLink token file", () => {
  it("round-trips bounded private state", () => {
    const dataDir = temporaryDataDir();
    saveWechatToken(dataDir, {
      botToken: "fixture-bot-token",
      botId: "fixture-bot",
      getUpdatesBuf: "cursor-1",
    });
    expect(loadWechatToken(dataDir)).toMatchObject({
      botToken: "fixture-bot-token",
      botId: "fixture-bot",
      getUpdatesBuf: "cursor-1",
    });
    if (process.platform !== "win32") {
      expect(fs.statSync(wechatTokenPath(dataDir)).mode & 0o777).toBe(0o600);
    }
  });

  it.runIf(process.platform !== "win32")("rejects a symlinked token file", () => {
    const dataDir = temporaryDataDir();
    const outside = path.join(temporaryDataDir(), "outside.json");
    fs.writeFileSync(outside, JSON.stringify({ botToken: "outside", botId: "outside" }), {
      mode: 0o600,
    });
    fs.symlinkSync(outside, wechatTokenPath(dataDir));
    expect(() => loadWechatToken(dataDir)).toThrow(/regular file, not a symlink/);
  });
});
