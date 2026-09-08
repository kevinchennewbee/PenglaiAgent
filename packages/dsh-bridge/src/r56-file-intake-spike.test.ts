import assert from "node:assert/strict";
import test from "node:test";
import { PenglaiError } from "@penglai/contracts";
import { PINNED_DSH } from "./index.js";
import {
  FILE_INTAKE_UNOFFICIAL_CODE,
  FILE_INTAKE_SPIKE_ID,
  OFFICIAL_CONVERSATION_INPUT_SLOTS,
  OFFICIAL_IMAGE_MEDIA_TYPES,
  probeOfficialFileIntake,
  refuseUnofficialFileTurnBinding,
} from "./r56-file-intake-spike.js";

test("R56-FILE-016 official DSH alpha.2 file intake spike is GO", () => {
  const report = probeOfficialFileIntake();
  assert.equal(report.requirement, FILE_INTAKE_SPIKE_ID);
  assert.equal(report.dsh, PINNED_DSH);
  assert.equal(report.verdict, "GO");
  assert.equal(report.blockCode, undefined);
  assert.deepEqual(report.officialImageMediaTypes, [
    ...OFFICIAL_IMAGE_MEDIA_TYPES,
  ]);
  assert.deepEqual(report.promptPartTypes, ["text", "image", "file"]);
  assert.ok(report.contentBlockTypes.includes("text"));
  assert.ok(report.contentBlockTypes.includes("image"));
  assert.ok(report.contentBlockTypes.includes("file"));
  assert.deepEqual(report.conversationInputSlots, [
    ...OFFICIAL_CONVERSATION_INPUT_SLOTS,
  ]);
  assert.deepEqual(report.composerDraftFields, ["draft", "attachmentIds"]);
  assert.deepEqual(report.genericFileApis, [
    "FileAttachmentRef",
    "EncodedFileAttachment",
    "type: 'file'",
  ]);
  assert.equal(report.fileReceiptField, "receiptId");
  assert.equal(report.fileUploadPath, "/api/session/uploadFileBinary");
  assert.ok(
    report.notes.some((note) => note.includes("Do not bind ordinary files")),
  );
  assert.ok(
    report.notes.some((note) => note.includes("uploadFile receiptId")),
  );
});

test("R56-FILE-016 refuses unofficial file-to-Turn binding", () => {
  assert.throws(
    () => refuseUnofficialFileTurnBinding(),
    (error: unknown) => {
      assert.ok(error instanceof PenglaiError);
      assert.equal(error.errorClass, "DSH_CONTRACT_DRIFT");
      assert.equal(error.message, FILE_INTAKE_UNOFFICIAL_CODE);
      return true;
    },
  );
});
