import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PRODUCT_VERSION } from "./pins.js";
import {
  assertPublicationOnlyChanges,
  assertWebsitePublication,
  parseSha256Sums,
  type WebsitePublicationInput,
} from "./website-publication.js";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const sourceSha = "a".repeat(40);
const repo = "kevinchennewbee/PenglaiAgent";
const tag = `v${PRODUCT_VERSION}`;
const names = [
  `Penglai_${PRODUCT_VERSION}_macos_aarch64.dmg`,
  `Penglai_${PRODUCT_VERSION}_macos_x64.dmg`,
  `Penglai_${PRODUCT_VERSION}_windows_x64_setup.exe`,
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
    return `https://github.com/${repo}/releases/download/${tag}/${installer.name} ${size} ${installer.sha256}`;
  });
  return [
    `Penglai ${PRODUCT_VERSION}`,
    "0.1.3-alpha.2",
    sourceSha,
    `https://github.com/${repo}/releases/tag/${tag}`,
    `docs/RELEASE_NOTES_${PRODUCT_VERSION}.md`,
    ...rows,
  ].join("\n");
}

function websiteNarrative(language: "chinese" | "english"): string {
  const title =
    language === "chinese"
      ? `<title>蓬莱 ${PRODUCT_VERSION} | 下载</title>`
      : `<title>Penglai ${PRODUCT_VERSION} | Download</title>`;
  return `${title}\n${narrative(false)}`;
}

function validInput(): WebsitePublicationInput {
  return {
    repo,
    version: PRODUCT_VERSION,
    tag,
    dshVersion: "0.1.3-alpha.2",
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
      "SECURITY.md",
      `docs/PUBLICATION_MANIFEST_${PRODUCT_VERSION}.md`,
      `docs/RELEASE_NOTES_${PRODUCT_VERSION}.md`,
      `docs/${PRODUCT_VERSION}/TODO.md`,
      "packages/release-identity/src/website-publication.ts",
      "scripts/readback-website.mjs",
      "website/index.html",
      "website/zh/index.html",
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

test("website publication binds public content to the current immutable tag and its peeled commit", () => {
  assert.doesNotThrow(() => assertWebsitePublication(validInput()));
});

test("website publication rejects a previous-version pin and a stale installer page", () => {
  const previous = validInput();
  previous.version = "0.0.0";
  previous.tag = "v0.0.0";
  assert.throws(() => assertWebsitePublication(previous), new RegExp(`not exact v${PRODUCT_VERSION.replaceAll(".", "\\.")}`));
  const stale = validInput();
  stale.files.chinese = stale.files.chinese.replaceAll(
    `${tag}/Penglai_${PRODUCT_VERSION}`,
    "v0.5.8/Penglai_0.5.8",
  );
  assert.throws(() => assertWebsitePublication(stale), /installer URLs/);
  const wrongTarget = validInput();
  wrongTarget.targetCommitish = "b".repeat(40);
  assert.throws(() => assertWebsitePublication(wrongTarget), /target_commitish/);
});

test("website publication rejects a stale HTML title even when current facts were appended", () => {
  const staleTitle = validInput();
  staleTitle.files.english = staleTitle.files.english.replace(
    `<title>Penglai ${PRODUCT_VERSION} | Download</title>`,
    `<title>Penglai 0.5.8 | Download</title>\n<title>Penglai ${PRODUCT_VERSION} | Download</title>`,
  );
  assert.throws(() => assertWebsitePublication(staleTitle), /stale 0\.5\.8 title/);
});

test("website publication permits only the post-readback narrative delta", () => {
  const required = [
    "README.md",
    `docs/PUBLICATION_MANIFEST_${PRODUCT_VERSION}.md`,
    `docs/RELEASE_NOTES_${PRODUCT_VERSION}.md`,
    "website/index.html",
    "website/zh/index.html",
    "website/en/index.html",
  ];
  assert.doesNotThrow(() =>
    assertPublicationOnlyChanges([...required, `docs/${PRODUCT_VERSION}/TODO.md`, "packages/release-identity/src/website-publication.ts"]),
  );
  assert.throws(
    () => assertPublicationOnlyChanges([...required, "apps/desktop/src/index.ts"]),
    /non-publication changes/,
  );
  assert.throws(() => assertPublicationOnlyChanges(["website/index.html", "website/zh/index.html", "website/en/index.html"]), /README\.md/);
  assert.throws(
    () => assertPublicationOnlyChanges(["README.md", "website/index.html", "website/zh/index.html", "website/en/index.html", `docs/RELEASE_NOTES_${PRODUCT_VERSION}.md`]),
    new RegExp(`PUBLICATION_MANIFEST_${PRODUCT_VERSION.replaceAll(".", "\\.")}`),
  );
  assert.throws(
    () => assertPublicationOnlyChanges([...required, "docs/PUBLICATION_0.5.10.md"]),
    /non-publication changes/,
  );
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
  assert.match(workflow, /needs: \[verify, deploy\]/);
  assert.match(workflow, /node scripts\/readback-website\.mjs --directory verified-site/);
  const readback = readFileSync(join(root, "scripts/readback-website.mjs"), "utf8");
  assert.ok(readback.includes('const origins = ["https://penglai.pages.dev/", "https://kevinchennewbee.github.io/PenglaiAgent/"];'));
  assert.match(readback, /digest\(bytes\) !== file\.sha256/);
  assert.match(readback, /isCloudflareRoutingConfig/);
  assert.match(readback, /cloudflare-routing-config/);
  assert.match(readback, /html\.includes\(releaseSha\)/);
  assert.match(readback, /Penglai \$\{version\}/);
  assert.doesNotMatch(readback, /Penglai 0\.5\.10/);
  const verifier = readFileSync(join(root, "scripts/verify-website-release.mjs"), "utf8");
  assert.match(verifier, /v\$\{contract\.version\}/);
  assert.doesNotMatch(verifier, /v0\.5\.10/);
  const publication = readFileSync(join(root, "packages/release-identity/src/website-publication.ts"), "utf8");
  assert.match(publication, /PRODUCT_VERSION/);
  assert.doesNotMatch(publication, /=== "0\.5\.10"/);
});
