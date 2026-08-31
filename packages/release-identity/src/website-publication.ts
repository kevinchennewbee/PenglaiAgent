const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;

export interface WebsiteInstallerRecord {
  name: string;
  size: number;
  sha256: string;
}

export interface WebsitePublicationInput {
  repo: string;
  version: string;
  tag: string;
  dshVersion: string;
  peeledSourceSha: string;
  targetCommitish: string;
  releaseManifestSourceSha: string;
  draft: boolean;
  prerelease: boolean;
  immutable: boolean;
  exactAssetNames: string[];
  actualAssetNames: string[];
  installers: WebsiteInstallerRecord[];
  sha256Sums: Record<string, string>;
  changedPaths: string[];
  files: {
    readme: string;
    chinese: string;
    english: string;
  };
}

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function exactSet(actual: string[], expected: string[], label: string): void {
  invariant(
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()),
    `${label} does not match the exact release set`,
  );
}

function installerUrls(content: string, repo: string): string[] {
  const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `https://github\\.com/${escaped}/releases/download/v[^/"'<\\s]+/Penglai_[^"'<\\s)]+`,
    "g",
  );
  return sortedUnique(content.match(pattern) ?? []);
}

function publicationPath(path: string): boolean {
  return (
    path === "README.md" ||
    path === "docs/PUBLICATION_0.5.9.md" ||
    path === "docs/PUBLICATION_MANIFEST_0.5.9.md" ||
    path === "docs/RELEASE_NOTES_0.5.9.md" ||
    path.startsWith("website/")
  );
}

export function assertPublicationOnlyChanges(paths: string[]): void {
  const changed = sortedUnique(paths.filter(Boolean));
  const forbidden = changed.filter((path) => !publicationPath(path));
  invariant(forbidden.length === 0, `post-tag website deployment contains non-publication changes: ${forbidden.join(", ")}`);
  for (const required of [
    "README.md",
    "docs/PUBLICATION_0.5.9.md",
    "docs/PUBLICATION_MANIFEST_0.5.9.md",
    "docs/RELEASE_NOTES_0.5.9.md",
    "website/index.html",
    "website/en/index.html",
  ]) {
    invariant(changed.includes(required), `post-readback publication did not update ${required}`);
  }
}

export function parseSha256Sums(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})  ([^/\\]+)$/.exec(line);
    const digest = match?.[1];
    const filename = match?.[2];
    invariant(digest && filename, `invalid SHA256SUMS line: ${line}`);
    invariant(result[filename] === undefined, `duplicate SHA256SUMS entry: ${filename}`);
    result[filename] = digest;
  }
  return result;
}

export function assertWebsitePublication(input: WebsitePublicationInput): void {
  const expectedTag = `v${input.version}`;
  invariant(input.version === "0.5.9" && input.tag === expectedTag, "website publication is not exact v0.5.9");
  invariant(HEX_40.test(input.peeledSourceSha), "peeled release source SHA is invalid");
  invariant(input.targetCommitish === input.peeledSourceSha, "Release target_commitish is not the exact peeled tag commit");
  invariant(input.releaseManifestSourceSha === input.peeledSourceSha, "release manifest source is not the peeled tag commit");
  invariant(input.draft === false && input.prerelease === false && input.immutable === true, "Release is not public immutable stable");
  exactSet(input.actualAssetNames, input.exactAssetNames, "GitHub Release assets");
  exactSet(Object.keys(input.sha256Sums), input.exactAssetNames.filter((name) => name !== "SHA256SUMS"), "SHA256SUMS");
  assertPublicationOnlyChanges(input.changedPaths);

  const tagUrl = `https://github.com/${input.repo}/releases/tag/${input.tag}`;
  const expectedUrls = input.installers.map(
    (installer) => `https://github.com/${input.repo}/releases/download/${input.tag}/${installer.name}`,
  );
  const narratives = [
    { label: "README", content: input.files.readme, exactBytes: true },
    { label: "Chinese website", content: input.files.chinese, exactBytes: false },
    { label: "English website", content: input.files.english, exactBytes: false },
  ];

  invariant(input.files.chinese.includes(`<title>蓬莱 ${input.version}`), "Chinese website title is not current");
  invariant(input.files.english.includes(`<title>Penglai ${input.version}`), "English website title is not current");
  invariant(!/<title>[^<]*0\.5\.8/.test(input.files.chinese), "Chinese website retains the stale 0.5.8 title");
  invariant(!/<title>[^<]*0\.5\.8/.test(input.files.english), "English website retains the stale 0.5.8 title");

  for (const narrative of narratives) {
    invariant(narrative.content.includes(`Penglai ${input.version}`), `${narrative.label} lacks the current product version`);
    invariant(narrative.content.includes(input.dshVersion), `${narrative.label} lacks the exact DSH version`);
    invariant(narrative.content.includes(input.peeledSourceSha), `${narrative.label} lacks the peeled release source SHA`);
    invariant(narrative.content.includes(tagUrl), `${narrative.label} lacks the exact Release URL`);
    exactSet(installerUrls(narrative.content, input.repo), expectedUrls, `${narrative.label} installer URLs`);
    for (const installer of input.installers) {
      invariant(Number.isSafeInteger(installer.size) && installer.size > 0, `${installer.name} size is invalid`);
      invariant(HEX_64.test(installer.sha256), `${installer.name} SHA-256 is invalid`);
      invariant(input.sha256Sums[installer.name] === installer.sha256, `${installer.name} does not match SHA256SUMS`);
      invariant(narrative.content.includes(installer.sha256), `${narrative.label} lacks ${installer.name} SHA-256`);
      const size = narrative.exactBytes
        ? new Intl.NumberFormat("en-US").format(installer.size)
        : `${(installer.size / 1024 / 1024).toFixed(1)} MiB`;
      invariant(narrative.content.includes(size), `${narrative.label} lacks the public size for ${installer.name}`);
    }
  }

  invariant(input.files.readme.includes(`docs/RELEASE_NOTES_${input.version}.md`), "README lacks current release notes");
}
