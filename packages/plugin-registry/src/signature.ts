import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";

export const ED25519_RAW_BYTES = 32;
export const ED25519_SIG_BYTES = 64;

export function publicKeyHexFromKey(key: KeyObject): string {
  const der = key.export({ type: "spki", format: "der" });
  return Buffer.from(der.subarray(-ED25519_RAW_BYTES)).toString("hex");
}

export function publicKeyFromHex(hex: string): KeyObject {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new PenglaiError("SECURITY_POLICY", "ed25519 public key hex invalid");
  const raw = Buffer.from(hex, "hex");
  const spki = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    raw,
  ]);
  return createPublicKey({ key: spki, format: "der", type: "spki" });
}

export function privateKeyFromPem(pem: string): KeyObject {
  if (!pem.includes("PRIVATE KEY")) throw new PenglaiError("SECURITY_POLICY", "private key pem required");
  return createPrivateKey(pem);
}

export function signBytes(bytes: Buffer, privateKey: KeyObject): Buffer {
  const signature = sign(null, bytes, privateKey);
  if (signature.length !== ED25519_SIG_BYTES) throw new PenglaiError("SECURITY_POLICY", "ed25519 signature length");
  return signature;
}

export function verifyBytes(bytes: Buffer, signature: Buffer, publicKeyHex: string): void {
  if (signature.length !== ED25519_SIG_BYTES) throw new PenglaiError("SECURITY_POLICY", "ed25519 signature length");
  const ok = verify(null, bytes, publicKeyFromHex(publicKeyHex), signature);
  if (!ok) throw new PenglaiError("SECURITY_POLICY", "ed25519 signature mismatch");
}

export function decodeDetachedSignature(bytes: Buffer): Buffer {
  if (bytes.length === ED25519_SIG_BYTES) return bytes;
  const encoded = bytes.toString("utf8").trim();
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== ED25519_SIG_BYTES) throw new PenglaiError("SECURITY_POLICY", "detached signature encoding");
  return decoded;
}

export function keyIdFromPublicHex(hex: string): string {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new PenglaiError("SECURITY_POLICY", "public key hex");
  return hex.slice(0, 24);
}
