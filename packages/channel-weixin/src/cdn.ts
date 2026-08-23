import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";
import { UploadMediaType, type WeixinCdnMedia } from "./protocol.js";

export const WEIXIN_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
const CDN_HOST_SUFFIXES = [
  "ilinkai.weixin.qq.com",
  ".weixin.qq.com",
  ".wechat.com",
  ".qpic.cn",
  ".qq.com",
] as const;

export interface WeixinVoiceMediaRef {
  media: WeixinCdnMedia;
  encodeType: number;
  sampleRate: number;
  playtimeMs: number;
}

/**
 * Tencent iLink has emitted both 4 and 6 for encrypted payloads whose
 * decrypted bytes are SILK. The codec layer still verifies the SILK magic
 * before decoding, so this gate remains a narrow vendor-enum compatibility
 * allowance rather than trusting the metadata as the codec authority.
 */
export function isSupportedWeixinSilkEncodeType(value: number): boolean {
  return value === 4 || value === 6;
}

export interface WeixinUploadedFile {
  downloadEncryptedQueryParam: string;
  aesKeyHex: string;
  bytes: number;
  encryptedBytes: number;
}

type WeixinUploadMediaType = typeof UploadMediaType.FILE | typeof UploadMediaType.VOICE;

function isAllowedCdnHost(hostname: string): boolean {
  return CDN_HOST_SUFFIXES.some((suffix) => suffix.startsWith(".") ? hostname.endsWith(suffix) : hostname === suffix);
}

function checkedCdnUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PenglaiError("SECURITY_POLICY", "Weixin CDN URL invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !isAllowedCdnHost(parsed.hostname)) {
    throw new PenglaiError("SECURITY_POLICY", "Weixin CDN URL rejected");
  }
  return parsed.toString();
}

function resolveDownloadUrl(media: WeixinCdnMedia, base: string): string {
  if (media.full_url) return checkedCdnUrl(media.full_url);
  if (!media.encrypt_query_param) throw new PenglaiError("INVALID_INPUT", "Weixin voice download reference missing");
  return checkedCdnUrl(`${base}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param)}`);
}

function parseAesKey(value: string | undefined): Buffer {
  if (!value || value.length > 128) throw new PenglaiError("SECURITY_POLICY", "Weixin voice AES key missing");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[a-f0-9]{32}$/i.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new PenglaiError("SECURITY_POLICY", "Weixin voice AES key rejected");
}

function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  try {
    const decipher = createDecipheriv("aes-128-ecb", key, null);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new PenglaiError("INVALID_INPUT", "Weixin voice decrypt failed");
  }
}

export async function downloadAndDecryptWeixinCdn(
  media: WeixinCdnMedia,
  base: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Buffer> {
  const url = resolveDownloadUrl(media, base);
  const key = parseAesKey(media.aes_key);
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET", redirect: "error", ...(signal ? { signal } : {}) });
  } catch {
    throw new PenglaiError("DELIVERY_TRANSIENT", "Weixin CDN download failed");
  }
  if (response.status === 401 || response.status === 403) {
    throw new PenglaiError("AUTH_EXPIRED", "Weixin CDN authorization failed");
  }
  if (!response.ok) throw new PenglaiError("DELIVERY_TRANSIENT", `Weixin CDN status ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > WEIXIN_MEDIA_MAX_BYTES + 16) {
    throw new PenglaiError("INVALID_INPUT", "Weixin encrypted size rejected");
  }
  const encrypted = Buffer.from(await response.arrayBuffer());
  if (!encrypted.length || encrypted.length > WEIXIN_MEDIA_MAX_BYTES + 16 || encrypted.length % 16 !== 0) {
    throw new PenglaiError("INVALID_INPUT", "Weixin ciphertext rejected");
  }
  const plaintext = decryptAesEcb(encrypted, key);
  if (!plaintext.length || plaintext.length > WEIXIN_MEDIA_MAX_BYTES) {
    throw new PenglaiError("INVALID_INPUT", "Weixin plaintext size rejected");
  }
  return plaintext;
}

export async function downloadAndDecryptWeixinVoice(
  ref: WeixinVoiceMediaRef,
  base: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (!isSupportedWeixinSilkEncodeType(ref.encodeType)) {
    throw new PenglaiError("INVALID_INPUT", "Weixin voice encode_type is not a supported SILK variant");
  }
  if (![8_000, 12_000, 16_000, 24_000].includes(ref.sampleRate)) {
    throw new PenglaiError("INVALID_INPUT", "Weixin voice sample rate rejected");
  }
  if (!Number.isSafeInteger(ref.playtimeMs) || ref.playtimeMs <= 0 || ref.playtimeMs > 180_000) {
    throw new PenglaiError("INVALID_INPUT", "Weixin voice duration rejected");
  }
  return downloadAndDecryptWeixinCdn(ref.media, base, fetchImpl, signal);
}

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

async function uploadWeixinEncryptedMedia(
  input: {
    data: Buffer;
    to: string;
    base: string;
    mediaType: WeixinUploadMediaType;
    getUploadUrl: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<WeixinUploadedFile> {
  if (!input.data.length || input.data.length > WEIXIN_MEDIA_MAX_BYTES) {
    throw new PenglaiError("INVALID_INPUT", "Weixin audio attachment size rejected");
  }
  const aesKey = randomBytes(16);
  const aesKeyHex = aesKey.toString("hex");
  const fileKey = randomBytes(16).toString("hex");
  const encrypted = encryptAesEcb(input.data, aesKey);
  const response = await input.getUploadUrl({
    filekey: fileKey,
    media_type: input.mediaType,
    to_user_id: input.to,
    rawsize: input.data.length,
    rawfilemd5: createHash("md5").update(input.data).digest("hex"),
    filesize: encrypted.length,
    no_need_thumb: true,
    aeskey: aesKeyHex,
  });
  const vendorCode = typeof response.ret === "number" && response.ret !== 0
    ? response.ret
    : typeof response.errcode === "number" && response.errcode !== 0
      ? response.errcode
      : 0;
  if (vendorCode !== 0) {
    throw new PenglaiError(
      vendorCode === -14 ? "AUTH_EXPIRED" : "DELIVERY_TRANSIENT",
      `getuploadurl-code-${vendorCode}`,
    );
  }
  const full = typeof response.upload_full_url === "string" ? response.upload_full_url.trim() : "";
  const param = typeof response.upload_param === "string" ? response.upload_param : "";
  const uploadUrl = full
    ? checkedCdnUrl(full)
    : param
      ? checkedCdnUrl(`${input.base}/upload?encrypted_query_param=${encodeURIComponent(param)}&filekey=${fileKey}`)
      : "";
  if (!uploadUrl) throw new PenglaiError("DELIVERY_TRANSIENT", "getuploadurl-missing-url");
  let uploaded: Response;
  try {
    uploaded = await fetchImpl(uploadUrl, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(encrypted),
    });
  } catch {
    throw new PenglaiError("DELIVERY_TRANSIENT", "cdn-upload-network");
  }
  if (uploaded.status === 401 || uploaded.status === 403) {
    throw new PenglaiError("AUTH_EXPIRED", `cdn-upload-status-${uploaded.status}`);
  }
  if (!uploaded.ok) throw new PenglaiError("DELIVERY_TRANSIENT", `cdn-upload-status-${uploaded.status}`);
  const downloadEncryptedQueryParam = uploaded.headers.get("x-encrypted-param") ?? "";
  if (!downloadEncryptedQueryParam || downloadEncryptedQueryParam.length > 4096) {
    throw new PenglaiError("DELIVERY_TRANSIENT", "cdn-upload-missing-receipt");
  }
  return {
    downloadEncryptedQueryParam,
    aesKeyHex,
    bytes: input.data.length,
    encryptedBytes: encrypted.length,
  };
}

export function uploadWeixinAudioFile(
  input: {
    data: Buffer;
    to: string;
    base: string;
    getUploadUrl: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<WeixinUploadedFile> {
  return uploadWeixinEncryptedMedia({ ...input, mediaType: UploadMediaType.FILE }, fetchImpl);
}

export function uploadWeixinVoice(
  input: {
    data: Buffer;
    to: string;
    base: string;
    getUploadUrl: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<WeixinUploadedFile> {
  return uploadWeixinEncryptedMedia({ ...input, mediaType: UploadMediaType.VOICE }, fetchImpl);
}
