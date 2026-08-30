import assert from "node:assert/strict";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import { PINNED_DSH } from "./index.js";
import {
  FILE_INTAKE_BLOCK_CODE,
  FILE_INTAKE_SPIKE_ID,
  OFFICIAL_CONVERSATION_INPUT_SLOTS,
  OFFICIAL_IMAGE_MEDIA_TYPES,
  probeOfficialFileIntake,
  refuseUnofficialFileTurnBinding,
} from "./r56-file-intake-spike.js";

test("R56-FILE-016 official DSH alpha.1 file intake spike is BLOCKED", () => {
  const report = probeOfficialFileIntake();
  assert.equal(report.requirement, FILE_INTAKE_SPIKE_ID);
  assert.equal(report.dsh, PINNED_DSH);
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.blockCode, FILE_INTAKE_BLOCK_CODE);
  assert.deepEqual(report.officialImageMediaTypes, [
    ...OFFICIAL_IMAGE_MEDIA_TYPES,
  ]);
  assert.deepEqual(report.promptPartTypes, ["text", "image"]);
  assert.ok(report.contentBlockTypes.includes("text"));
  assert.ok(report.contentBlockTypes.includes("image"));
  assert.equal(report.contentBlockTypes.includes("file"), false);
  assert.deepEqual(report.conversationInputSlots, [
    ...OFFICIAL_CONVERSATION_INPUT_SLOTS,
  ]);
  assert.deepEqual(report.composerDraftFields, ["draft", "imageIds"]);
  assert.deepEqual(report.genericFileApis, []);
  assert.ok(
    report.notes.some((note) => note.includes("Do not bind ordinary files")),
  );
});

test("R56-FILE-016 refuses unofficial file-to-Turn binding", () => {
  assert.throws(
    () => refuseUnofficialFileTurnBinding(),
    (error: unknown) => {
      assert.ok(error instanceof PenglaiError);
      assert.equal(error.errorClass, "DSH_CONTRACT_DRIFT");
      assert.equal(error.message, FILE_INTAKE_BLOCK_CODE);
      return true;
    },
  );
});
