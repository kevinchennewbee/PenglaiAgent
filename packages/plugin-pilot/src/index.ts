import { PenglaiError } from "@penglai/contracts";

export const name = "@penglai/plugin-pilot";
export const inject: string[] = [];
export const version = "1.0.0";

export function apply(ctx?: { tools?: { register(definition: Record<string, unknown>): unknown } }): { version: string } {
  ctx?.tools?.register({
    name: "penglai_pilot_echo",
    description: "Return a fixed reviewed-pilot token. No network, no filesystem, no secrets.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    async execute() {
      if (arguments.length > 1) throw new PenglaiError("INVALID_INPUT", "pilot tool takes no authority args");
      return { token: "penglai-pilot-ok", nativeCode: false, network: false };
    },
  });
  return { version };
}

Object.assign(apply, { inject });
export default { name, inject, apply, version };
