import { PenglaiError } from "@penglai/contracts";

function serialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PenglaiError("INVALID_INPUT", "canonical JSON rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => serialize(item)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${serialize((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  throw new PenglaiError("INVALID_INPUT", "canonical JSON rejects undefined/function values");
}

export function canonicalize(value: unknown): string {
  return serialize(value);
}

export function canonicalizeBytes(value: unknown): Buffer {
  return Buffer.from(canonicalize(value), "utf8");
}
