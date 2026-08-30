import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./repo.mjs";

export const RELEASE_PINS_SOURCE = "packages/release-identity/src/pins.ts";

function oneMatch(source, pattern, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new Error(
      `release pin ${label} must have one closed source declaration`,
    );
  }
  return matches[0][1];
}

function stringPin(source, name) {
  return oneMatch(
    source,
    new RegExp(`export const ${name} =\\s*"([^"\\n]+)";`, "g"),
    name,
  );
}

function numberPin(source, name) {
  const value = Number(
    oneMatch(source, new RegExp(`export const ${name} = ([0-9]+);`, "g"), name),
  );
  if (!Number.isSafeInteger(value))
    throw new Error(`release pin ${name} is not a safe integer`);
  return value;
}

function objectBlock(source, name) {
  return oneMatch(
    source,
    new RegExp(
      `export const ${name} = Object\\.freeze\\(\\{([\\s\\S]*?)\\n\\}\\);`,
      "g",
    ),
    name,
  );
}

function objectString(block, owner, key) {
  return oneMatch(
    block,
    new RegExp(`\\n  ${key}: "([^"\\n]+)",`, "g"),
    `${owner}.${key}`,
  );
}

function releaseTargets(source) {
  const block = oneMatch(
    source,
    /export const RELEASE_TARGETS = \[([\s\S]*?)\n\] as const;/g,
    "RELEASE_TARGETS",
  );
  const rows = [
    ...block.matchAll(
      /\{\n    key: "([^"\n]+)",\n    platform: "([^"\n]+)",\n    arch: "([^"\n]+)",\n    installer: "([^"\n]+)",\n  \}/g,
    ),
  ].map((match) => ({
    key: match[1],
    platform: match[2],
    arch: match[3],
    installer: match[4],
  }));
  if (
    rows.length !== 3 ||
    new Set(rows.map((row) => row.key)).size !== rows.length
  ) {
    throw new Error(
      "release pin RELEASE_TARGETS must contain three unique closed rows",
    );
  }
  return rows;
}

export function readReleaseIdentityPins(root = ROOT) {
  const source = readFileSync(join(root, RELEASE_PINS_SOURCE), "utf8").replace(
    /\r\n?/g,
    "\n",
  );
  const publicationBlock = objectBlock(source, "PUBLICATION_TARGET");
  return Object.freeze({
    productName: stringPin(source, "PRODUCT_NAME"),
    productVersion: stringPin(source, "PRODUCT_VERSION"),
    candidateKind: stringPin(source, "CANDIDATE_KIND"),
    trustTier: stringPin(source, "TRUST_TIER"),
    generationId: stringPin(source, "GENERATION_ID"),
    signatureKind: stringPin(source, "SIGNATURE_KIND"),
    node: stringPin(source, "PINNED_NODE"),
    pnpm: stringPin(source, "PINNED_PNPM"),
    electron: stringPin(source, "PINNED_ELECTRON"),
    dsh: stringPin(source, "PINNED_DSH"),
    dshSource: Object.freeze({
      repository: stringPin(source, "PINNED_DSH_REPOSITORY"),
      tag: stringPin(source, "PINNED_DSH_TAG"),
      commit: stringPin(source, "PINNED_DSH_COMMIT"),
      closureManifestSha256: stringPin(
        source,
        "PINNED_DSH_CLOSURE_MANIFEST_SHA256",
      ),
      cliTarballSha256: stringPin(source, "PINNED_DSH_TARBALL_SHA256"),
      packageCount: numberPin(source, "PINNED_DSH_CLOSURE_PACKAGE_COUNT"),
    }),
    profileSchema: numberPin(source, "PROFILE_SCHEMA"),
    catalogSchema: numberPin(source, "CATALOG_SCHEMA"),
    imSchema: numberPin(source, "IM_SCHEMA"),
    publication: Object.freeze({
      repo: objectString(publicationBlock, "PUBLICATION_TARGET", "repo"),
      tag: objectString(publicationBlock, "PUBLICATION_TARGET", "tag"),
      release: objectString(publicationBlock, "PUBLICATION_TARGET", "release"),
      channel: objectString(publicationBlock, "PUBLICATION_TARGET", "channel"),
    }),
    targets: Object.freeze(
      releaseTargets(source).map((row) => Object.freeze(row)),
    ),
  });
}
