import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PenglaiError } from "@penglai/contracts";

export const PENGLAI_CJK_FONT_SHA256 = "d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964";
export const PENGLAI_CJK_FONT_LICENSE = "OFL-1.1";

export function penglaiCjkFontPath(): string {
  const explicit = process.env.PENGLAI_OFFICE_CJK_FONT;
  if (explicit && existsSync(explicit)) return explicit;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../fonts/NotoSansSC-VF.ttf"),
    join(here, "../../fonts/NotoSansSC-VF.ttf"),
    join(here, "../resources/fonts/NotoSansSC-VF.ttf"),
    join(process.env.PENGLAI_APP_ROOT ?? "", "resources", "office-fonts", "NotoSansSC-VF.ttf"),
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
