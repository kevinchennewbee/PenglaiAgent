import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError, PenglaiRemote } from "@penglai/contracts";

interface AsrSettingsHost {
  describeCapability(): {
    plugin: "active";
    engine: string;
    model: string;
    enterTurn: false;
    queueDepth: number;
    activeTranscriptions: number;
  };
  describeModels(): unknown;
  prepareModel(operationId: string): unknown;
  pauseDownload(operationId: string): unknown;
  resumeDownload(operationId: string): unknown;
  cancelDownload(operationId: string): unknown;
  getOperation(operationId: string): unknown;
  stageAudio(
    buf: Buffer,
    input: { source: "attachment"; ownerOperation: string },
  ): Promise<{ id: string }>;
  transcribe(
    handle: { id: string },
    options: { authorized: true; claimed: true; privateChat: true },
    operationId: string,
  ): Promise<{
    draft: { language?: string; emotion?: string; noSpeech?: boolean; text: string };
    draftDigest: string;
  }>;
}

const OPERATION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_TEST_BYTES = 2 * 1024 * 1024;

function assertOperationId(operationId: string): void {
  if (!OPERATION_ID.test(operationId)) {
    throw new PenglaiError("INVALID_INPUT", "ASR operation id rejected");
  }
}

export function createAsrSettingsApi(service: AsrSettingsHost) {
  return {
    describe() {
      const capability = service.describeCapability();
      return {
        plugin: capability.plugin,
        engine: capability.engine,
        model: capability.model,
        enterTurn: false,
        queueDepth: capability.queueDepth,
        activeTranscriptions: capability.activeTranscriptions,
      };
    },
    describeModels() {
      return service.describeModels();
    },
    prepareModel(operationId: string) {
      assertOperationId(operationId);
      return service.prepareModel(operationId);
    },
    pauseDownload(operationId: string) {
      assertOperationId(operationId);
      return service.pauseDownload(operationId);
    },
    resumeDownload(operationId: string) {
      assertOperationId(operationId);
      return service.resumeDownload(operationId);
    },
    cancelDownload(operationId: string) {
      assertOperationId(operationId);
      return service.cancelDownload(operationId);
    },
    getOperation(operationId: string) {
      assertOperationId(operationId);
      return service.getOperation(operationId);
    },
    async testTranscribe(input: { wavBase64: string; operationId: string }) {
      assertOperationId(input.operationId);
      if (service.describeCapability().model !== "ready") {
        throw new PenglaiError("DSH_UNAVAILABLE", "SenseVoice model is not installed");
      }
      if (typeof input.wavBase64 !== "string" || !input.wavBase64) {
        throw new PenglaiError("INVALID_INPUT", "ASR test audio required");
      }
      const buf = Buffer.from(input.wavBase64, "base64");
      if (buf.length <= 0 || buf.length > MAX_TEST_BYTES) {
        throw new PenglaiError("INVALID_INPUT", "ASR test audio size rejected");
      }
      const handle = await service.stageAudio(buf, {
        source: "attachment",
        ownerOperation: input.operationId,
      });
      const result = await service.transcribe(
        handle,
        { authorized: true, claimed: true, privateChat: true },
        input.operationId,
      );
      return {
        language: result.draft.language,
        emotion: result.draft.emotion,
        noSpeech: Boolean(result.draft.noSpeech),
        draftDigest: result.draftDigest,
        text: result.draft.text,
        charCount: result.draft.text.length,
      };
    },
  };
}

export class PenglaiAsrRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly api: ReturnType<typeof createAsrSettingsApi>,
  ) {
    super(ctx, "penglaiAsrSettings");
  }

  @PenglaiRemote
  describe() {
    return this.api.describe();
  }

  @PenglaiRemote
  describeModels() {
    return this.api.describeModels();
  }

  @PenglaiRemote
  prepareModel(input: { operationId: string }) {
    return this.api.prepareModel(input.operationId);
  }

  @PenglaiRemote
  pauseDownload(input: { operationId: string }) {
    return this.api.pauseDownload(input.operationId);
  }

  @PenglaiRemote
  resumeDownload(input: { operationId: string }) {
    return this.api.resumeDownload(input.operationId);
  }

  @PenglaiRemote
  cancelDownload(input: { operationId: string }) {
    return this.api.cancelDownload(input.operationId);
  }

  @PenglaiRemote
  getOperation(input: { operationId: string }) {
    return this.api.getOperation(input.operationId);
  }

  @PenglaiRemote
  testTranscribe(input: { wavBase64: string; operationId: string }) {
    return this.api.testTranscribe(input);
  }
}

export const TYPERT_REMOTE = {
  package: "@penglai/asr",
  descriptors: [
    "describe",
    "describeModels",
    "prepareModel",
    "pauseDownload",
    "resumeDownload",
    "cancelDownload",
    "getOperation",
    "testTranscribe",
  ],
};
