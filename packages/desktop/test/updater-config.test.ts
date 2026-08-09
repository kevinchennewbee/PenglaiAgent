/**
 * Updater 配置契约测试（0.4.x 自动升级的静态面）。
 *
 * 钉死：tauri.conf.json 的 updater 块（真实 minisign 公钥——不是 tauri 文档
 * 示例公钥；endpoint 指向 GitHub Releases 的 latest.json）、
 * createUpdaterArtifacts、renderer 不可直通 updater 的权限面、latest.json.template 与
 * generate-latest-json.mjs 的平台键一致性、版本比较语义。
 *
 * 真实的签名校验（minisign 验签 + 安装 + 回滚）属 CI 发布链与真机演练：
 * tauri-plugin-updater 在 install_app_update 里验签，本测试不覆盖密码学。
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions } from "../src/state/format.js";

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_TAURI = path.join(DESKTOP, "src-tauri");

const conf = JSON.parse(
  fs.readFileSync(path.join(SRC_TAURI, "tauri.conf.json"), "utf-8"),
) as {
  version: string;
  plugins?: { updater?: { pubkey?: string; endpoints?: string[] } };
  bundle?: { createUpdaterArtifacts?: boolean };
};

/** tauri 文档示例公钥（其私钥人人皆知，配置成它 = 更新链彻底失守）。 */
const TAURI_DOCS_EXAMPLE_KEY_ID = "270552BCE2E63863";

describe("tauri.conf.json updater 块", () => {
  it("配置了真实 minisign 公钥（可解码、格式正确、不是文档示例）", () => {
    const pubkey = conf.plugins?.updater?.pubkey ?? "";
    expect(pubkey.length).toBeGreaterThan(0);
    const decoded = Buffer.from(pubkey, "base64").toString("utf-8");
    const lines = decoded.split("\n").filter(Boolean);
    expect(lines[0]).toMatch(/^untrusted comment: minisign public key: [0-9A-F]{16}$/);
    const keyId = lines[0].replace(/^.*: /, "");
    expect(keyId).not.toBe(TAURI_DOCS_EXAMPLE_KEY_ID);
    // 第二行是 base64 的 Ed25519 公钥记录（2 字节算法 + 8 字节 keynum + 32 字节公钥 = 42 字节）
    const record = Buffer.from(lines[1], "base64");
    expect(record.length).toBe(42);
    expect(record.subarray(0, 2).toString("utf-8")).toBe("Ed");
  });

  it("endpoint 只读 canonical GitHub 的 desktop-v0.4 元数据通道", () => {
    const endpoints = conf.plugins?.updater?.endpoints ?? [];
    expect(endpoints).toEqual([
      "https://github.com/kevinchennewbee/PenglaiAgent/releases/download/desktop-v0.4/latest.json",
    ]);
    expect(JSON.stringify(endpoints)).not.toContain("gh-proxy");
  });

  it("createUpdaterArtifacts 开启（发布链产出 .tar.gz + .sig）", () => {
    expect(conf.bundle?.createUpdaterArtifacts).toBe(true);
  });

  it("版本号是三段数字 semver", () => {
    expect(conf.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("capabilities 权限面", () => {
  it("renderer 不能绕过原生备份封装直调 updater；仍允许原生通知", () => {
    const capabilities = JSON.parse(
      fs.readFileSync(path.join(SRC_TAURI, "capabilities", "default.json"), "utf-8"),
    ) as { permissions: string[] };
    expect(capabilities.permissions).toContain("notification:default");
    for (const permission of capabilities.permissions) {
      expect(permission).not.toMatch(/^updater:/);
    }
  });
});

describe("latest.json 契约（模板 ↔ 生成器 ↔ 工作流）", () => {
  it("模板平台键与 release-contract.json 的平台矩阵一致", () => {
    const template = JSON.parse(
      fs.readFileSync(path.join(DESKTOP, "updater", "latest.json.template"), "utf-8"),
    ) as { platforms: Record<string, { signature: string; url: string }> };
    const contract = JSON.parse(
      fs.readFileSync(path.join(DESKTOP, "updater", "release-contract.json"), "utf-8"),
    ) as { platforms: Array<{ key: string }> };
    const generatorKeys = contract.platforms.map((platform) => platform.key);
    const templateKeys = Object.keys(template.platforms);
    expect(templateKeys.sort()).toEqual(generatorKeys.sort());
    expect(templateKeys).toContain("darwin-aarch64");
    expect(templateKeys).toContain("windows-x86_64");
    // 每个平台：signature 占位 + 指向同一仓库 Release 资产的 https url
    for (const platform of Object.values(template.platforms)) {
      expect(platform.signature).toMatch(/^REPLACE_WITH_|^untrusted comment:|^[A-Za-z0-9+/=]{20,}/);
      expect(platform.url).toMatch(/^https:\/\//);
      expect(platform.url).toContain("kevinchennewbee/PenglaiAgent");
    }
  });

  it("工作流从 secrets 读 TAURI_SIGNING_PRIVATE_KEY（与 signer 提示同名）", () => {
    const workflow = fs.readFileSync(
      path.resolve(DESKTOP, "../../.github/workflows/host-release.yml"),
      "utf-8",
    );
    expect(workflow).toContain("secrets.TAURI_SIGNING_PRIVATE_KEY");
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
    // latest.json 由生成器产出并随 Release 发布
    expect(workflow).toContain("generate-latest-json.mjs");
    expect(workflow).toContain("latest.json");
    expect(workflow).toContain("desktop-v0.4");
    expect(workflow).toContain("verify-release-assets.mjs");
  });
});

describe("版本比较（更新判定语义）", () => {
  it("0.4.x 升级序：patch/minor 递增可判定", () => {
    expect(compareVersions("0.4.1", "0.4.0")).toBe(1);
    expect(compareVersions("0.5.0", "0.4.9")).toBe(1);
    expect(compareVersions("0.4.0", "0.4.0")).toBe(0);
    expect(compareVersions("0.4.0", "0.4.1")).toBe(-1);
    expect(compareVersions("0.10.0", "0.4.9")).toBe(1); // 非字典序，按段数值
  });
});
