import { PenglaiError } from "@penglai/contracts";

export const ELECTRON_FUSE_SENTINEL = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";

export const FUSE_NAMES = [
  "runAsNode",
  "enableCookieEncryption",
  "enableNodeOptionsEnvironmentVariable",
  "enableNodeCliInspectArguments",
  "enableEmbeddedAsarIntegrityValidation",
  "onlyLoadAppFromAsar",
  "loadBrowserProcessSpecificV8Snapshot",
  "grantFileProtocolExtraPrivileges",
] as const;

export type FuseName = (typeof FUSE_NAMES)[number];

export interface FuseInspection {
  version: number;
  count: number;
  offset: number;
  values: Partial<Record<FuseName, boolean>>;
}

export function inspectFuseWire(buf: Buffer): FuseInspection {
  const idx = buf.indexOf(ELECTRON_FUSE_SENTINEL);
  if (idx < 0) throw new PenglaiError("INVALID_INPUT", "electron fuse sentinel missing");
  const version = buf[idx + ELECTRON_FUSE_SENTINEL.length] ?? 0;
  const count = buf[idx + ELECTRON_FUSE_SENTINEL.length + 1] ?? 0;
  if (version !== 1 || count < 4) throw new PenglaiError("INVALID_INPUT", "unsupported fuse wire");
  const values: FuseInspection["values"] = {};
  for (let i = 0; i < Math.min(count, FUSE_NAMES.length); i += 1) {
    const b = buf[idx + ELECTRON_FUSE_SENTINEL.length + 2 + i];
    values[FUSE_NAMES[i]!] = b === 0x31;
  }
  return { version, count, offset: idx, values };
}

export function applyFuseWire(buf: Buffer, updates: Partial<Record<FuseName, boolean>>): Buffer {
  const info = inspectFuseWire(buf);
  const out = Buffer.from(buf);
  for (const [name, enabled] of Object.entries(updates) as Array<[FuseName, boolean]>) {
    const i = (FUSE_NAMES as readonly string[]).indexOf(name);
    if (i < 0 || i >= info.count) throw new PenglaiError("INVALID_INPUT", `unknown fuse ${name}`);
    out[info.offset + ELECTRON_FUSE_SENTINEL.length + 2 + i] = enabled ? 0x31 : 0x30;
  }
  return out;
}

export function assertRequiredFuses(values: FuseInspection["values"]): void {
  if (values.runAsNode !== false) throw new PenglaiError("SECURITY_POLICY", "RunAsNode must be disabled");
  if (values.enableNodeOptionsEnvironmentVariable !== false) {
    throw new PenglaiError("SECURITY_POLICY", "NODE_OPTIONS must be disabled");
  }
  if (values.enableNodeCliInspectArguments !== false) {
    throw new PenglaiError("SECURITY_POLICY", "Node CLI inspect must be disabled");
  }
}
