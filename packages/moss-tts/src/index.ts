import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { PenglaiError, RELEASE } from "@penglai/contracts";
import { createMossTtsService } from "./service.js";
import { createMossTtsSettingsApi, PenglaiMossTtsRemote } from "./remote.js";

export const name = "@penglai/moss-tts";
export const inject: string[] = [];
export const version = RELEASE;

interface FileCapabilityHost {
  resolveReadDirectory(capabilityRef: string): Promise<string>;
}

interface CordisContextLike {
  provide?: (serviceName: string, service: unknown) => unknown;
  effect?: (setup: () => () => Promise<void>) => unknown;
}

function optionalCapabilityResolver(ctx: CordisContextLike): ((ref: string) => Promise<string>) | undefined {
  const host = Object.getOwnPropertyDescriptor(ctx, "penglaiFileCapabilities")?.value as FileCapabilityHost | undefined;
  if (!host || typeof host.resolveReadDirectory !== "function") return undefined;
  return (ref: string) => host.resolveReadDirectory(ref);
}

function requireUserData(): string {
  const userData = process.env.PENGLAI_USER_DATA;
  if (!userData) {
    throw new PenglaiError(
      "DSH_UNAVAILABLE",
      "PENGLAI_USER_DATA required for @penglai/moss-tts",
    );
  }
  return userData;
}

export function apply(ctx: CordisContextLike) {
  const userData = requireUserData();
  if (!ctx.provide) {
    throw new PenglaiError(
      "DSH_UNAVAILABLE",
      "Cordis provide service required for MOSS-TTS",
    );
  }
  if (!ctx.effect) {
    throw new PenglaiError(
      "DSH_UNAVAILABLE",
      "Cordis effect lifecycle required for MOSS-TTS",
    );
  }
  const service = createMossTtsService({
    modelsDir: join(userData, "voice", "models", "moss-tts"),
    tempDir: join(userData, "voice", "temp", "moss-tts"),
    ...((): { resolveCapability?: (ref: string) => Promise<string> } => {
      const resolveCapability = optionalCapabilityResolver(ctx);
      return resolveCapability ? { resolveCapability } : {};
    })(),
  });
  ctx.provide("penglaiMossTts", service);
  ctx.effect(() => () => service.dispose());
  if (ctx instanceof Context) {
    new PenglaiMossTtsRemote(ctx, createMossTtsSettingsApi(service));
  }
  return service;
}

Object.assign(apply, { inject });
export default { name, inject, apply, version };
export * from "./service.js";
export * from "./models.js";
export * from "./engine.js";
export * from "./output-registry.js";
export * from "./synth.js";
