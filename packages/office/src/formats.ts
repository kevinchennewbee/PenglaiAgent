import { PenglaiError } from "@penglai/contracts";

export type OfficeFormat = "docx" | "xlsx" | "pptx" | "pdf";

export function asOfficeFormat(value: unknown): OfficeFormat {
  if (value === "docx" || value === "xlsx" || value === "pptx" || value === "pdf") return value;
  throw new PenglaiError("INVALID_INPUT", "unsupported office format");
}
