import { describe, expect, it } from "vitest";
import {
  imageOnlyPrompt,
  MAX_IMAGES_PER_PROMPT,
  sanitizeImages,
} from "../src/image-sanitize.js";

describe("sanitizeImages", () => {
  it("passes through common raster types and normalizes jpg→jpeg", () => {
    const out = sanitizeImages([
      { data: "AAAA", mimeType: "image/png" },
      { data: "BBBB", mimeType: "image/JPG" },
      { data: "CCCC", mimeType: "image/gif" },
      { data: "DDDD", mimeType: "image/webp" },
    ]);
    expect(out.map((i) => i.mimeType)).toEqual([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]);
  });

  it("rejects SVG and non-image mime types", () => {
    const out = sanitizeImages([
      { data: "x", mimeType: "image/svg+xml" },
      { data: "x", mimeType: "text/plain" },
      { data: "x", mimeType: "application/octet-stream" },
    ]);
    expect(out).toEqual([]);
  });

  it("strips whitespace from base64 data", () => {
    const out = sanitizeImages([
      { data: "AA BB\nCC\r\nDD", mimeType: "image/png" },
    ]);
    expect(out[0]?.data).toBe("AABBCCDD");
  });

  it("drops entries with empty data", () => {
    const out = sanitizeImages([
      { data: "", mimeType: "image/png" },
      { data: "   ", mimeType: "image/png" },
      { data: "AAAA", mimeType: "image/png" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("caps to MAX_IMAGES_PER_PROMPT", () => {
    const images = Array.from({ length: 10 }, (_, i) => ({
      data: `data${i}`,
      mimeType: "image/png",
    }));
    expect(sanitizeImages(images)).toHaveLength(MAX_IMAGES_PER_PROMPT);
  });

  it("rejects images above the ~4 MiB encoded ceiling", () => {
    const big = "A".repeat(Math.ceil(4 * 1024 * 1024 * 1.4) + 10);
    const out = sanitizeImages([
      { data: big, mimeType: "image/png" },
      { data: "small", mimeType: "image/png" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.data).toBe("small");
  });

  it("truncates name to 80 chars and returns [] for undefined input", () => {
    const longName = "n".repeat(120);
    const out = sanitizeImages([{ data: "AAAA", mimeType: "image/png", name: longName }]);
    expect(out[0]?.name).toHaveLength(80);
    expect(sanitizeImages(undefined)).toEqual([]);
  });
});

describe("imageOnlyPrompt", () => {
  it("uses singular vs plural Chinese wording", () => {
    expect(imageOnlyPrompt(1)).toBe("请查看这张图片。");
    expect(imageOnlyPrompt(3)).toBe("请查看这 3 张图片。");
  });
});
