import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PenglaiError } from "@penglai/contracts";

export interface OfficeReceiptClaims {
  jobId: string;
  sourceDigest: string;
  opsDigest: string;
  workspaceId?: string;
  exp: number;
}

export function createReceiptSecret(): Buffer {
  return randomBytes(32);
}

export function issueOfficeReceipt(secret: Buffer, claims: OfficeReceiptClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyOfficeReceipt(secret: Buffer, receipt: string, expected: Omit<OfficeReceiptClaims, "exp">): OfficeReceiptClaims {
  if (typeof receipt !== "string" || !receipt.includes(".")) {
    throw new PenglaiError("SECURITY_POLICY", "office commit requires a signed owner receipt");
  }
  const [payload, mac] = receipt.split(".");
  if (!payload || !mac) throw new PenglaiError("SECURITY_POLICY", "office receipt malformed");
  const expectedMac = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(mac);
  const right = Buffer.from(expectedMac);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new PenglaiError("SECURITY_POLICY", "office receipt rejected");
  }
  let claims: OfficeReceiptClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OfficeReceiptClaims;
  } catch {
    throw new PenglaiError("SECURITY_POLICY", "office receipt payload rejected");
  }
  if (claims.jobId !== expected.jobId || claims.sourceDigest !== expected.sourceDigest || claims.opsDigest !== expected.opsDigest) {
    throw new PenglaiError("SECURITY_POLICY", "office receipt binding mismatch");
  }
  if ((claims.workspaceId ?? "") !== (expected.workspaceId ?? "")) {
    throw new PenglaiError("SECURITY_POLICY", "office receipt workspace mismatch");
  }
  if (!Number.isFinite(claims.exp) || claims.exp < Date.now()) {
    throw new PenglaiError("SECURITY_POLICY", "office receipt expired");
  }
  return claims;
}
