/**
 * Image attachment sanitization used by the unified EpisodeRunner
 * server bridge. Keeps the chat and agent.* paths from drifting on the
 * mime allowlist, size cap, and jpg→jpeg normalization.
 */

export interface ImageAttachment {
  /** base64 without data: prefix */
  data: string;
  mimeType: string;
  name?: string;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MiB decoded per image
export const MAX_IMAGES_PER_PROMPT = 4;

/**
 * Normalize and filter inbound image attachments. Drops anything that is
 * not a common raster type, exceeds the size cap, or has no data. SVG is
 * rejected to avoid an XSS surface if a client ever renders it naively.
 */
export function sanitizeImages(
  images: ImageAttachment[] | undefined,
): ImageAttachment[] {
  if (!images?.length) return [];
  const out: ImageAttachment[] = [];
  for (const raw of images.slice(0, MAX_IMAGES_PER_PROMPT)) {
    const mimeType = (raw.mimeType || "").toLowerCase();
    if (!mimeType.startsWith("image/")) continue;
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(mimeType)) continue;
    const rawData = raw.data || "";
    if (rawData.length > Math.ceil(MAX_IMAGE_BYTES * 1.5)) continue;
    const data = rawData.replace(/\s+/g, "");
    // base64 inflates by ~4/3; compare against the encoded ceiling.
    if (
      !data ||
      data.length > Math.ceil(MAX_IMAGE_BYTES * 1.4) ||
      data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
    ) continue;
    const decodedBytes = Buffer.from(data, "base64").byteLength;
    if (decodedBytes === 0 || decodedBytes > MAX_IMAGE_BYTES) continue;
    out.push({
      data,
      mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType,
      name: raw.name?.slice(0, 80),
    });
  }
  return out;
}

/** Fallback prompt text when the owner sends images but no text. */
export function imageOnlyPrompt(count: number): string {
  return count === 1 ? "请查看这张图片。" : `请查看这 ${count} 张图片。`;
}
