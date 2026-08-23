import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PenglaiError } from "@penglai/contracts";

export const PENGLAI_CJK_FONT_SHA256 = "8b925746dd6c4a4a6b79b41101cebb2d13002ea82c0018b8cb0658127371f214";
export const PENGLAI_CJK_FONT_LICENSE = "OFL-1.1";

export function penglaiCjkFontPath(): string {
  const explicit = process.env.PENGLAI_OFFICE_CJK_FONT;
  if (explicit && existsSync(explicit)) return explicit;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../fonts/PenglaiCjkOfl.ttf"),
    join(here, "../../fonts/PenglaiCjkOfl.ttf"),
    join(here, "../resources/fonts/PenglaiCjkOfl.ttf"),
    join(process.env.PENGLAI_APP_ROOT ?? "", "resources", "office-fonts", "PenglaiCjkOfl.ttf"),
  ];
  const hit = candidates.find((path) => existsSync(path));
  if (!hit) throw new PenglaiError("DSH_UNAVAILABLE", "Penglai CJK OFL font missing from Office resources");
  return hit;
}

export function loadPenglaiCjkFont(): Buffer {
  const path = penglaiCjkFontPath();
  const bytes = readFileSync(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== PENGLAI_CJK_FONT_SHA256) {
    throw new PenglaiError("SECURITY_POLICY", "Penglai CJK OFL font hash mismatch");
  }
  return bytes;
}
