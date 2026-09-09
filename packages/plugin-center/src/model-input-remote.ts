import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { PenglaiError, PenglaiRemote } from "@penglai/contracts";
import type { OfficialUsableCtx } from "./onboarding.js";
import {
  listOfficialDeepSeekCatalog,
  modalitiesAcceptImage,
  setOfficialDeepSeekImageInput,
} from "./model-input-modalities.js";

export function createPenglaiModelInputImpl(official: OfficialUsableCtx) {
  return {
    async list() {
      const models = await listOfficialDeepSeekCatalog(official);
      return {
        ns: "llm-deepseek",
        models: models.map((row) => ({
          id: row.id,
          ...(row.name ? { name: row.name } : {}),
          imageInput: modalitiesAcceptImage(row.inputModalities),
        })),
      };
    },
    async setImageInput(input: { modelId: string; enabled: boolean }) {
      if (!input || typeof input.modelId !== "string") {
        throw new PenglaiError("INVALID_INPUT", "model id required");
      }
      const models = await setOfficialDeepSeekImageInput(official, {
        modelId: input.modelId,
        enabled: input.enabled === true,
      });
      return {
        ns: "llm-deepseek",
        models: models.map((row) => ({
          id: row.id,
          ...(row.name ? { name: row.name } : {}),
          imageInput: modalitiesAcceptImage(row.inputModalities),
        })),
      };
    },
  };
}

export class PenglaiModelInputRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly impl: ReturnType<typeof createPenglaiModelInputImpl>,
  ) {
    super(ctx, "penglaiModelInput");
  }

  @PenglaiRemote
  list() {
    return this.impl.list();
  }

  @PenglaiRemote
  setImageInput(input: { modelId: string; enabled: boolean }) {
    return this.impl.setImageInput(input);
  }
}
