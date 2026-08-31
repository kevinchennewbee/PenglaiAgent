import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertPublicationOnlyChanges,
  assertWebsitePublication,
  parseSha256Sums,
  type WebsitePublicationInput,
} from "./website-publication.js";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const sourceSha = "a".repeat(40);
const repo = "kevinchennewbee/PenglaiAgent";
const names = [
  "Penglai_0.5.9_macos_aarch64.dmg",
  "Penglai_0.5.9_macos_x64.dmg",
  "Penglai_0.5.9_windows_x64_setup.exe",
];
const installers = names.map((name, index) => ({
  name,
  size: (index + 1) * 1048576,
  sha256: String(index + 1).repeat(64),
}));
const exactAssets = [
  ...names,
  "update-manifest-v1.json",
  "update-manifest-v1.json.sig",
  "release-manifest.json",
  "SBOM.cdx.json",
  "THIRD_PARTY_NOTICES.txt",
  "SHA256SUMS",
  "public-export-manifest.json",
];
const sums = Object.fromEntries(
  exactAssets
    .filter((name) => name !== "SHA256SUMS")
    .map((name, index) => [name, String((index % 9) + 1).repeat(64)]),
);
for (const installer of installers) sums[installer.name] = installer.sha256;

function narrative(exactBytes: boolean): string {
  const rows = installers.map((installer) => {
    const size = exactBytes
      ? new Intl.NumberFormat("en-US").format(installer.size)
      : `${(installer.size / 1024 / 1024).toFixed(1)} MiB`;
    return `https://github.com/${repo}/releases/download/v0.5.9/${installer.name} ${size} ${installer.sha256}`;
  });
  return [
    "Penglai 0.5.9",
    "0.1.2-alpha.2",
    sourceSha,
    `https://github.com/${repo}/releases/tag/v0.5.9`,
    "docs/RELEASE_NOTES_0.5.9.md",
    ...rows,
  ].join("\n");
}

function websiteNarrative(language: "chinese" | "english"): string {
  const title = language === "chinese" ? "<title>蓬莱 0.5.9 | 下载</title>" : "<title>Penglai 0.5.9 | Download</title>";
  return `${title}\n${narrative(false)}`;
}

function validInput(): WebsitePublicationInput {
  return {
    repo,
    version: "0.5.9",
    tag: "v0.5.9",
    dshVersion: "0.1.2-alpha.2",
    peeledSourceSha: sourceSha,
    targetCommitish: sourceSha,
    releaseManifestSourceSha: sourceSha,
    draft: false,
    prerelease: false,
    immutable: true,
    exactAssetNames: exactAssets,
    actualAssetNames: [...exactAssets],
    installers,
    sha256Sums: sums,
    changedPaths: [
      "README.md",
      "docs/PUBLICATION_0.5.9.md",
      "docs/PUBLICATION_MANIFEST_0.5.9.md",
      "docs/RELEASE_NOTES_0.5.9.md",
      "website/index.html",
      "website/en/index.html",
      "website/styles/main.css",
    ],
    files: {
      readme: narrative(true),
      chinese: websiteNarrative("chinese"),
      english: websiteNarrative("english"),
    },
  };
}

test("website publication binds public content to immutable v0.5.9 and its peeled commit", () => {
  assert.doesNotThrow(() => assertWebsitePublication(validInput()));
});

test("website publication rejects a stale 0.5.8 installer page and wrong target_commitish", () => {
  const stale = validInput();
  stale.files.chinese = stale.files.chinese.replaceAll("v0.5.9/Penglai_0.5.9", "v0.5.8/Penglai_0.5.8");
  assert.throws(() => assertWebsitePublication(stale), /installer URLs/);
  const wrongTarget = validInput();
  wrongTarget.targetCommitish = "b".repeat(40);
  assert.throws(() => assertWebsitePublication(wrongTarget), /target_commitish/);
});

test("website publication rejects a stale 0.5.8 HTML title even when current facts were appended", () => {
  const staleTitle = validInput();
  staleTitle.files.english = staleTitle.files.english.replace(
    "<title>Penglai 0.5.9 | Download</title>",
    "<title>Penglai 0.5.8 | Download</title>\n<title>Penglai 0.5.9 | Download</title>",
  );
  assert.throws(() => assertWebsitePublication(staleTitle), /stale 0\.5\.8 title/);
});

test("website publication permits only the post-readback narrative delta", () => {
  assert.throws(
    () => assertPublicationOnlyChanges(["README.md", "website/index.html", "website/en/index.html", "apps/desktop/src/index.ts"]),
    /non-publication changes/,
  );
  assert.throws(() => assertPublicationOnlyChanges(["website/index.html", "website/en/index.html"]), /README\.md/);
});

test("SHA256SUMS parser rejects duplicate or malformed entries", () => {
  const line = `${"1".repeat(64)}  release-manifest.json`;
  assert.deepEqual(parseSha256Sums(line), { "release-manifest.json": "1".repeat(64) });
  assert.throws(() => parseSha256Sums(`${line}\n${line}`), /duplicate/);
  assert.throws(() => parseSha256Sums("not-a-sum"), /invalid/);
});

test("website workflow grants write only to the main-gated deployment job", () => {
  const workflow = readFileSync(join(root, ".github/workflows/deploy-website.yml"), "utf8");
  assert.equal(workflow.match(/contents: write/g)?.length, 1);
  assert.match(workflow, /permissions:\r?\n  contents: read/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /pnpm readback:release "\$\{\{ inputs\.tag \}\}"/);
  assert.match(workflow, /verify-website-release\.mjs/);
  assert.match(workflow, /test -s website\/favicon\.svg/);
  assert.match(workflow, /find website -type l -print -quit/);
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/);
  assert.match(workflow, /Read back the public GitHub Pages deployment/);
  assert.equal(
    workflow
      .split(/\r?\n/)
      .some(
        (line) =>
          line.trim() ===
          'english="$(curl --fail --silent --show-error --location --max-time 20 https://kevinchennewbee.github.io/PenglaiAgent/en/ || true)"',
      ),
    true,
  );
  assert.match(workflow, /grep -Fq "\$RELEASE_SHA"/);
});
