import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import { PRODUCT_VERSION } from "./pins.js";
import {
  assertCohortFreeze,
  COHORT_FREEZE_KIND,
  REJECTED_DSH_SUCCESSOR_TAG,
  type CohortFreezeRecord,
} from "./freeze.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadFreeze(): CohortFreezeRecord {
  return JSON.parse(readFileSync(join(root, "docs/0.5.12/COHORT_FREEZE.json"), "utf8")) as CohortFreezeRecord;
}

function loadContract() {
  return JSON.parse(readFileSync(join(root, "release-contract.json"), "utf8")) as {
    version: string;
    dshVersion: string;
    dshSource: { tag: string; commit: string; packageCount: number; closureManifestSha256?: string; cliTarballSha256?: string };
    publication: { tag: string };
  };
}

test("0.5.12 publication-authorized freeze retitles identity and keeps 0.5.11 immutable", () => {
  const freeze = loadFreeze();
  const releaseContract = loadContract();
  const productVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version as string;
  assertCohortFreeze({ freeze, productVersion, releaseContract });
  assert.equal(freeze.kind, COHORT_FREEZE_KIND);
  assert.equal(freeze.status, "publication-authorized");
  assert.equal(freeze.dsh.rejectedSuccessor.tag, REJECTED_DSH_SUCCESSOR_TAG);
  assert.equal(productVersion, "0.5.12");
  assert.equal(productVersion, PRODUCT_VERSION);
  assert.equal(releaseContract.publication.tag, "v0.5.12");
  assert.equal(freeze.previousPublicRelease?.tag, "v0.5.11");
  assert.equal(readFileSync(join(root, "packages/contracts/src/index.ts"), "utf8").includes('export const RELEASE = "0.5.12"'), true);
});

test("cohort freeze rejects mixed DSH generations and rewriting v0.5.11", () => {
  const freeze = loadFreeze();
  const releaseContract = loadContract();
  const productVersion = PRODUCT_VERSION;
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
          previousPublicRelease: { productVersion: "0.5.11", tag: "v0.5.11", immutable: false as never },
        },
        productVersion,
        releaseContract,
      }),
    /published 0.5.11 identity must stay immutable/,
  );
  assert.throws(
    () =>
      assertCohortFreeze({
        freeze: {
          ...freeze,
          publicRelease: { ...freeze.publicRelease, productVersion: "0.5.10" },
        },
        productVersion,
        releaseContract,
      }),
    /public release identity drifted/,
  );
});
