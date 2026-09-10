import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import {
  PINNED_DSH,
  PINNED_DSH_CLOSURE_MANIFEST_SHA256,
  PINNED_DSH_CLOSURE_PACKAGE_COUNT,
  PINNED_DSH_COMMIT,
  PINNED_DSH_TAG,
  PINNED_DSH_TARBALL_SHA256,
  PRODUCT_VERSION,
} from "./pins.js";
import {
  assertCohortFreeze,
  COHORT_FREEZE_KIND,
  PUBLISHED_0512_FREEZE_KIND,
  REJECTED_DSH_SUCCESSOR_TAG,
  type CohortFreezeRecord,
} from "./freeze.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadPublished0512Freeze() {
  return JSON.parse(readFileSync(join(root, "docs/0.5.12/COHORT_FREEZE.json"), "utf8")) as {
    kind: string;
    status: string;
    dsh: { version: string; tag: string; commit: string; rejectedSuccessor: { tag: string } };
    previousPublicRelease?: { tag: string };
  };
}

function loadDevelopmentFreeze(): CohortFreezeRecord {
  return JSON.parse(readFileSync(join(root, "docs/0.6.1/COHORT_FREEZE.json"), "utf8")) as CohortFreezeRecord;
}

function loadContract() {
  return JSON.parse(readFileSync(join(root, "release-contract.json"), "utf8")) as {
    version: string;
    dshVersion: string;
    dshSource: { tag: string; commit: string; packageCount: number; closureManifestSha256?: string; cliTarballSha256?: string };
    publication: { tag: string };
  };
}

test("0.5.12 publication-authorized freeze stays immutable and is not the 0.6 development DSH pin", () => {
  const freeze = loadPublished0512Freeze();
  const releaseContract = loadContract();
  const productVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version as string;
  assert.equal(freeze.kind, PUBLISHED_0512_FREEZE_KIND);
  assert.equal(freeze.status, "publication-authorized");
  assert.equal(freeze.dsh.version, "0.1.3-alpha.2");
  assert.equal(freeze.dsh.tag, "dsh-v0.1.3-alpha.2");
  assert.equal(freeze.dsh.commit, "82a5fd61a7cf5c293cec4bdff68f455398d685e9");
  assert.equal(freeze.dsh.rejectedSuccessor.tag, REJECTED_DSH_SUCCESSOR_TAG);
  assert.equal(productVersion, "0.6.1");
  assert.equal(productVersion, PRODUCT_VERSION);
  assert.equal(releaseContract.publication.tag, "v0.6.1");
  assert.equal(freeze.previousPublicRelease?.tag, "v0.5.11");
  assert.equal(readFileSync(join(root, "packages/contracts/src/index.ts"), "utf8").includes('export const RELEASE = "0.6.1"'), true);
  assert.equal(PINNED_DSH, "0.1.5-rc.1");
  assert.notEqual(freeze.dsh.version, PINNED_DSH);
  assert.equal(releaseContract.dshVersion, PINNED_DSH);
  const development = loadDevelopmentFreeze();
  assert.equal(development.kind, COHORT_FREEZE_KIND);
  assert.equal(development.status, "development-frozen");
  assert.equal(development.dsh.version, PINNED_DSH);
  assert.equal(development.dsh.tag, PINNED_DSH_TAG);
  assert.equal(development.dsh.commit, PINNED_DSH_COMMIT);
  assert.equal(development.dsh.packageCount, PINNED_DSH_CLOSURE_PACKAGE_COUNT);
  assert.equal(development.dsh.tarballSha256, PINNED_DSH_TARBALL_SHA256);
  assert.equal(development.dsh.closureManifestSha256, PINNED_DSH_CLOSURE_MANIFEST_SHA256);
  assert.equal(development.publicRelease.tag, "v0.6.1");
  assert.equal(development.publicRelease.immutable, false);
  assert.equal(development.previousPublicRelease?.tag, "v0.6.0");
  assert.equal(development.previousPublicRelease?.immutable, true);
});

test("cohort freeze rejects mixed DSH generations and rewriting v0.5.12", () => {
  const freeze = loadDevelopmentFreeze();
  const releaseContract = loadContract();
  const productVersion = PRODUCT_VERSION;
  assertCohortFreeze({ freeze, productVersion, releaseContract });
  assert.throws(
    () =>
      assertCohortFreeze({
        freeze: {
          ...freeze,
          dsh: { ...freeze.dsh, version: "0.1.3-alpha.1" },
        },
        productVersion,
        releaseContract,
      }),
    (error: unknown) => error instanceof PenglaiError && /pinned DSH identity/.test(error.message),
  );
  assert.throws(
    () =>
      assertCohortFreeze({
        freeze: {
          ...freeze,
          previousPublicRelease: { productVersion: "0.5.12", tag: "v0.5.12", immutable: false as never },
        },
        productVersion,
        releaseContract,
      }),
    /published 0.6.0 identity must stay immutable/,
  );
  assert.throws(
    () =>
      assertCohortFreeze({
        freeze: {
          ...freeze,
          publicRelease: { ...freeze.publicRelease, productVersion: "0.5.12" },
        },
        productVersion,
        releaseContract,
      }),
    /public release identity drifted/,
  );
});
