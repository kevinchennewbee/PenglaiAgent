import { PenglaiError } from "@penglai/contracts";
import { toDataURL } from "qrcode";

const PNG_PREFIX = "data:image/png;base64,";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPngDataUrl(value: string): boolean {
  if (!value.startsWith(PNG_PREFIX)) return false;
  const buf = Buffer.from(value.slice(PNG_PREFIX.length), "base64");
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC);
}

export async function renderQrPngDataUrl(payload: string): Promise<string> {
  const raw = payload.trim();
  if (!raw) throw new PenglaiError("INVALID_INPUT", "qr payload missing");
  if (isPngDataUrl(raw)) return raw;
  const compact = raw.replace(/\s/g, "");
  if (/^iVBOR[A-Za-z0-9+/]+=*$/.test(compact)) {
    const wrapped = PNG_PREFIX + compact;
    if (isPngDataUrl(wrapped)) return wrapped;
  }
  const dataUrl = await toDataURL(raw, {
    type: "image/png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 256,
    color: { dark: "#000000", light: "#ffffff" },
  });
  if (!isPngDataUrl(dataUrl)) throw new PenglaiError("INVALID_INPUT", "qr render failed");
  return dataUrl;
}
