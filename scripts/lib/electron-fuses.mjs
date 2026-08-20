import { readFileSync, writeFileSync } from "node:fs";

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
];

export function inspectFuseWire(buf) {
  const idx = buf.indexOf(ELECTRON_FUSE_SENTINEL);
  if (idx < 0) throw new Error("electron fuse sentinel missing");
  const version = buf[idx + ELECTRON_FUSE_SENTINEL.length] ?? 0;
  const count = buf[idx + ELECTRON_FUSE_SENTINEL.length + 1] ?? 0;
  if (version !== 1 || count < 4) throw new Error("unsupported fuse wire");
  const values = {};
  for (let i = 0; i < Math.min(count, FUSE_NAMES.length); i += 1) {
    values[FUSE_NAMES[i]] = buf[idx + ELECTRON_FUSE_SENTINEL.length + 2 + i] === 0x31;
  }
  return { version, count, offset: idx, values };
}

export function applyFuseWire(buf, updates) {
  const info = inspectFuseWire(buf);
  const out = Buffer.from(buf);
  for (const [name, enabled] of Object.entries(updates)) {
    const i = FUSE_NAMES.indexOf(name);
    if (i < 0 || i >= info.count) throw new Error(`unknown fuse ${name}`);
    out[info.offset + ELECTRON_FUSE_SENTINEL.length + 2 + i] = enabled ? 0x31 : 0x30;
  }
  return out;
}

export function inspectBinary(path) {
  return inspectFuseWire(readFileSync(path));
}

export function writeRequiredFuses(path) {
  const before = readFileSync(path);
  const after = applyFuseWire(before, {
    runAsNode: false,
    enableNodeCliInspectArguments: false,
    enableNodeOptionsEnvironmentVariable: false,
  });
  if (Buffer.compare(before, after) !== 0) writeFileSync(path, after);
  const info = inspectFuseWire(readFileSync(path));
  if (info.values.runAsNode !== false || info.values.enableNodeCliInspectArguments !== false) {
    throw new Error("failed to write required fuses");
  }
  return info;
}
