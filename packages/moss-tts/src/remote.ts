import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError } from "@penglai/contracts";
import { digestFinal, type PenglaiMossTtsService } from "./service.js";

const OPERATION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const PREVIEW: Record<"zh" | "en" | "ja", string> = {
  zh: "蓬莱本地语音试听。",
  en: "Penglai local voice preview.",
  ja: "蓬莱の音声プレビューです。",
};

function assertOperationId(operationId: string): void {
  if (!OPERATION_ID.test(operationId)) {
    throw new PenglaiError("INVALID_INPUT", "TTS operation id rejected");
  }
}

export function createMossTtsSettingsApi(service: PenglaiMossTtsService) {
  return {
    describe() {
      const capability = service.describeCapability();
      return {
        plugin: capability.plugin,
        engine: capability.engine,
        model: capability.model,
        queueDepth: capability.queueDepth,
        activeSyntheses: capability.activeSyntheses,
      };
    },
    describeModels() {
      return service.describeModels();
    },
    listVoices() {
      return service.listVoices();
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
    async previewVoice(input: { voiceId: string; locale: "zh" | "en" | "ja"; operationId: string }) {
      assertOperationId(input.operationId);
      if (service.describeCapability().model !== "ready") {
        throw new PenglaiError("DSH_UNAVAILABLE", "MOSS-TTS model is not installed");
      }
      const locale = PREVIEW[input.locale] ? input.locale : "zh";
      const finalText = PREVIEW[locale];
      const result = await service.synthesize({
        operationId: input.operationId,
        sourceFinalId: `settings-preview:${input.operationId}`,
        finalText,
        finalDigest: digestFinal(finalText),
        voiceId: input.voiceId,
        locale,
      });
      const wav = await service.readOutput(result.handle, input.operationId);
      await service.releaseOutput(result.handle.id);
      return {
        digest: result.operation.outputDigest,
        bytes: wav.length,
        durationMs: result.operation.durationMs,
        wavBase64: wav.toString("base64"),
      };
    },
  };
}

export class PenglaiMossTtsRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly api: ReturnType<typeof createMossTtsSettingsApi>,
  ) {
    super(ctx, "penglaiMossTtsSettings");
  }

  @Remote
  describe() {
    return this.api.describe();
  }

  @Remote
  describeModels() {
    return this.api.describeModels();
  }

  @Remote
  listVoices() {
    return this.api.listVoices();
  }

  @Remote
  prepareModel(input: { operationId: string }) {
    return this.api.prepareModel(input.operationId);
  }

  @Remote
  pauseDownload(input: { operationId: string }) {
    return this.api.pauseDownload(input.operationId);
  }

  @Remote
  resumeDownload(input: { operationId: string }) {
    return this.api.resumeDownload(input.operationId);
  }

  @Remote
  cancelDownload(input: { operationId: string }) {
    return this.api.cancelDownload(input.operationId);
  }

  @Remote
  getOperation(input: { operationId: string }) {
    return this.api.getOperation(input.operationId);
  }

  @Remote
  previewVoice(input: { voiceId: string; locale: "zh" | "en" | "ja"; operationId: string }) {
    return this.api.previewVoice(input);
  }
}

export const TYPERT_REMOTE = {
  package: "@penglai/moss-tts",
  descriptors: [
    "describe",
    "describeModels",
    "listVoices",
    "prepareModel",
    "pauseDownload",
    "resumeDownload",
    "cancelDownload",
    "getOperation",
    "previewVoice",
  ],
};
