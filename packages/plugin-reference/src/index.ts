export const name = "@penglai/plugin-reference";
export const inject: string[] = [];
export const version = process.env.PENGLAI_REFERENCE_VERSION ?? "1.0.0";

export function apply(): { version: string } {
  return { version };
}

Object.assign(apply, { inject });
export default { name, inject, apply, version };
