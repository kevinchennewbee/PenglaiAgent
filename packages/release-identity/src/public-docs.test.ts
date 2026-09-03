import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_VERSION, PINNED_DSH } from "./pins.js";
import {
  assertCommittedTemplateIdentity,
  assertObservedReleaseFacts,
  assertReleaseIdentity,
} from "./identity.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("historical 0.5.8 release notes preserve their original release facts", () => {
  const notes = readFileSync(join(root, "docs/RELEASE_NOTES_0.5.8.md"), "utf8");
  assert.match(notes, /Settings → Penglai →\s*Updates/i);
  assert.match(notes, /0\.5\.1/);
  assert.match(notes, /community-verified/);
  assert.match(notes, /not notarized/);
  assert.match(notes, /silent auto-update/i);
  assert.match(notes, /Plugin Center/);
  assert.match(notes, /Penglai_0\.5\.8_macos_x64\.dmg/);
  assert.match(notes, /Penglai_0\.5\.8_windows_x64_setup\.exe/);
  assert.match(notes, /dsh-v0\.1\.2-alpha\.1/i);
  assert.match(notes, /no upstream internal-test notice/i);
  assert.match(notes, /WhatsApp is not a 0\.5\.8 product surface/i);
  assert.match(notes, /LIVE_NOT_RUN/);
  assert.doesNotMatch(notes, /already notarized|App Store|zero-config Feishu|全自动升级/);

});

test("historical 0.5.8 manifest preserves its exact three-target release", () => {
  const md = readFileSync(join(root, "docs/PUBLICATION_MANIFEST_0.5.8.md"), "utf8");
  const committed = assertReleaseIdentity(JSON.parse(readFileSync(join(root, "release-info.json"), "utf8")));
  assertCommittedTemplateIdentity(committed);
  assert.match(md, /Penglai_0\.5\.8_macos_aarch64\.dmg/);
  assert.match(md, /Penglai_0\.5\.8_macos_x64\.dmg/);
  assert.match(md, /Penglai_0\.5\.8_windows_x64_setup\.exe/);
  assert.match(md, /public-export-manifest\.json/);
  assert.match(md, /kevinchennewbee\/PenglaiAgent/);
  assert.match(md, /PUBLIC_READBACK_PASS/);
  assert.match(md, /phase=UNFROZEN/);
  assert.match(md, /sourceSha=NONE/);
  assert.match(md, /community-verified/);
  assert.doesNotMatch(md, /pending public readback/i);
  assert.match(md, /upstream internal notice false/i);
  assert.match(md, /251 reproducible local tarballs/i);
  const observedCells = [
    ...md.matchAll(/\| [^|\n]*`Penglai_0\.5\.8_[^`]+`[^|\n]*\| ([0-9,]+) \| `([0-9a-f]{64})` \|/g),
  ];
  assert.equal(observedCells.length, 3);
  for (const cell of observedCells) {
    assertObservedReleaseFacts({
      readbackStatus: "PASS",
      bytes: cell[1]?.replace(/,/g, "").trim(),
      sha: cell[2]?.replace(/`/g, "").trim(),
    });
  }

});

test("fuse policy disables RunAsNode and inspect and forbids dryRun green", () => {
  const policy = JSON.parse(readFileSync(join(root, "packaging/electron-fuses.json"), "utf8"));
  assert.equal(policy.runAsNode, false);
  assert.equal(policy.enableNodeCliInspectArguments, false);
  assert.equal(policy.enableNodeOptionsEnvironmentVariable, false);
  assert.equal(policy.dryRun, false);
  const verify = readFileSync(join(root, "scripts/verify-fuses.mjs"), "utf8");
  assert.match(verify, /inspectBinary/);
  assert.match(verify, /packaged-electron-framework-bytes/);
});

test("website keeps the full bilingual visual site during publication preparation", () => {
  const zh = readFileSync(join(root, "website/index.html"), "utf8");
  const en = readFileSync(join(root, "website/en/index.html"), "utf8");
  const css = readFileSync(join(root, "website/styles/main.css"), "utf8");
  const requiredAssets = [
    "website/favicon.svg",
    "website/shots/banner-v1.png",
    "website/shots/0.5.5/plugin-center.png",
    "website/shots/0.5.5/office.png",
    "website/shots/0.5.5/memory.png",
    "website/shots/0.5.5/mobile-messaging.png",
    "website/shots/0.5.5/welcome.png",
  ];

  for (const rel of requiredAssets) {
    const path = join(root, rel);
    assert.equal(existsSync(path), true, `${rel} missing`);
    assert.ok(statSync(path).size > 100, `${rel} is unexpectedly small`);
  }
  for (const html of [zh, en]) {
    assert.match(html, /shots\/banner-v1\.png/);
    assert.match(html, /shots\/0\.5\.5\/plugin-center\.png/);

  }
  assert.match(css, /\.hero-art/);
  assert.match(css, /\.gallery/);
  assert.ok(css.length > 5000, "website stylesheet is unexpectedly reduced");
});

test("current product, architecture and security contracts use the selected release", () => {
  const product = readFileSync(join(root, "docs/PRODUCT.md"), "utf8");
  const architecture = readFileSync(join(root, "docs/ARCHITECTURE.md"), "utf8");
  const security = readFileSync(join(root, "docs/SECURITY.md"), "utf8");
  const im = readFileSync(join(root, "docs/IM_PLUGIN.md"), "utf8");
  for (const text of [product, architecture, security, im]) {
    assert.ok(text.includes(PRODUCT_VERSION));
    assert.ok(text.includes(PINNED_DSH));
    assert.doesNotMatch(text, /disabled WhatsApp compatibility card|说明卡没有连接/);
  }
  assert.match(security, /提供八个平台的真实连接 adapter/);
  assert.match(im, /八个平台都有真实连接入口/);
  assert.match(im, /未经修改的官方 npm 字节/);
  const constitution = readFileSync(join(root, "PRODUCT_CONSTITUTION.md"), "utf8");
  assert.ok(constitution.includes(`当前产品与发布契约为 **Penglai v${PRODUCT_VERSION}**`));
});

const publicationManifestPath = join(root, `docs/PUBLICATION_MANIFEST_${PRODUCT_VERSION}.md`);
// Publication is a later phase. The deployment verifier requires these files
// after immutable readback; old documentation must never create a current PASS.
test("published README, website and security match the current observed manifest", {
  skip: !existsSync(publicationManifestPath) && "current immutable publication has not occurred",
}, () => {
  const manifest = readFileSync(publicationManifestPath, "utf8");
  const notes = readFileSync(join(root, `docs/RELEASE_NOTES_${PRODUCT_VERSION}.md`), "utf8");
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const pages = ["website/index.html", "website/en/index.html"].map((path) => readFileSync(join(root, path), "utf8"));
  const contract = JSON.parse(readFileSync(join(root, "release-contract.json"), "utf8"));
  assert.ok(manifest.includes("PUBLIC_READBACK_PASS"));
  assert.ok(notes.includes(PINNED_DSH));
  assert.ok(notes.includes("not notarized"));
  for (const target of contract.targets) {
    const row = manifest.split(/\r?\n/).find((line) => line.startsWith("|") && line.includes(target.installer));
    assert.ok(row, `current manifest is missing ${target.installer}`);
    const cells = row.split("|").map((cell) => cell.trim());
    const sha = cells.find((cell) => /^`[a-f0-9]{64}`$/.test(cell))?.slice(1, -1);
    const bytes = cells.find((cell) => /^[1-9][0-9,]*$/.test(cell));
    assert.ok(sha && bytes, `current manifest lacks exact bytes for ${target.installer}`);
    for (const content of [readme, ...pages]) {
      assert.ok(content.includes(PRODUCT_VERSION) && content.includes(PINNED_DSH));
      assert.ok(content.includes(`https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v${PRODUCT_VERSION}/${target.installer}`));
      assert.ok(content.includes(sha));
    }
    assert.ok(readme.includes(bytes));
    for (const page of pages) assert.ok(page.includes(`${(Number(bytes.replaceAll(",", "")) / 1048576).toFixed(1)} MiB`));
  }
  const security = readFileSync(join(root, "SECURITY.md"), "utf8");
  assert.ok(security.includes(`${PRODUCT_VERSION} | Current immutable public release`));
  assert.ok(security.includes(PINNED_DSH));
  assert.match(security, /Eight platforms have connection entries/);
  assert.match(security, /security\/advisories\/new/);
  assert.doesNotMatch([readme, ...pages, security].join("\n"), /two-hour installed soak remain|两小时安装版稳定运行仍/);
});

test("decision identifiers are unique and the final distribution decision supersedes D-060", () => {
  const decisions = readFileSync(join(root, "docs/decisions.md"), "utf8");
  const ids = [...decisions.matchAll(/^### (D-\d+)\b/gm)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "docs/decisions.md contains a duplicate decision ID");
  assert.match(decisions, /D-060[\s\S]*?SUPERSEDED by D-061/);
  assert.match(decisions, /D-061[\s\S]*?八个平台连接入口/);
});

test("backticked repository documentation references resolve to tracked files", () => {
  function markdownFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return markdownFiles(path);
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    });
  }

  const files = [...markdownFiles(join(root, "docs")), join(root, "README.md"), join(root, "SECURITY.md")];
  for (const file of files) {
    const markdown = readFileSync(file, "utf8");
    for (const match of markdown.matchAll(/`(docs\/[A-Za-z0-9_./-]+\.md)`/g)) {
      assert.equal(existsSync(join(root, match[1]!)), true, `${match[1]} referenced by ${file} does not exist`);
    }
  }
});
