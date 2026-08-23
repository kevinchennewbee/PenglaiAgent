import { Transform } from "node:stream";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  fstatSync,
  fsyncSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { PenglaiError } from "@penglai/contracts";
import { assertSafeDownloadUrl } from "@penglai/plugin-registry";
import {
  nextUpdateState,
  readBoundUpdatePayload,
  verifyPayload,
  writeUpdateJournal,
  type UpdateJournal,
  type UpdateManifest,
  type UpdateState,
} from "./update.js";

export interface DownloadProgress {
  bytes: number;
  expected: number;
  path: string;
}

export async function downloadVerifiedPayload(opts: {
  url: string;
  destDir: string;
  expectedSha256: string;
  expectedSize: number;
  signature: Buffer;
  publicKeyHex: string;
  fetchImpl?: typeof fetch;
  resume?: boolean;
  signal?: AbortSignal;
}): Promise<{ path: string; bytes: number; kind: "dmg" | "setup" }> {
  if (!opts.url.startsWith("https://") || opts.url.includes("latest")) {
    throw new PenglaiError("SECURITY_POLICY", "mutable or non-https asset URL");
  }
  if (!isAbsolute(opts.destDir)) throw new PenglaiError("SECURITY_POLICY", "update destination must be absolute");
  if (!/^[a-f0-9]{64}$/.test(opts.expectedSha256)) {
    throw new PenglaiError("SECURITY_POLICY", "update sha256 invalid");
  }
  if (!Number.isSafeInteger(opts.expectedSize) || opts.expectedSize <= 0 || opts.expectedSize > 8 * 1024 * 1024 * 1024) {
    throw new PenglaiError("SECURITY_POLICY", "update size invalid");
  }
  mkdirSync(opts.destDir, { recursive: true, mode: 0o700 });
  const urlPath = new URL(opts.url).pathname;
  const suffix = extname(urlPath).toLowerCase();
  const kind = suffix === ".dmg" ? "dmg" : suffix === ".exe" ? "setup" : undefined;
  if (!kind) throw new PenglaiError("INVALID_INPUT", "update payload must be a DMG or Setup EXE");
  const part = join(opts.destDir, `${opts.expectedSha256}${suffix}.part`);
  const finalPath = join(opts.destDir, `${opts.expectedSha256}${suffix}`);
  if (existsSync(finalPath)) {
    const bytes = readBoundUpdatePayload(finalPath, opts.expectedSize, {
      forbidExecutable: true,
    });
    verifyPayload(bytes, opts.expectedSha256, opts.signature, opts.publicKeyHex);
    return { path: finalPath, bytes: bytes.length, kind };
  }
  let existing = 0;
  if (opts.resume && existsSync(part)) {
    const stat = lstatSync(part);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new PenglaiError("SECURITY_POLICY", "update partial must be a regular file");
    }
    if (process.platform !== "win32" && (stat.mode & 0o111) !== 0) {
      throw new PenglaiError("SECURITY_POLICY", "update partial must not be executable");
    }
    existing = stat.size;
  }
  if (existing > opts.expectedSize) {
    rmSync(part, { force: true });
    existing = 0;
  }
  if (existing === opts.expectedSize) {
    const complete = readBoundUpdatePayload(part, opts.expectedSize, {
      forbidExecutable: true,
    });
    try {
      verifyPayload(complete, opts.expectedSha256, opts.signature, opts.publicKeyHex);
    } catch (error) {
      rmSync(part, { force: false, maxRetries: 0 });
      throw error;
    }
    renameSync(part, finalPath);
    chmodSync(finalPath, 0o600);
    try {
      const committed = readBoundUpdatePayload(finalPath, opts.expectedSize, {
        forbidExecutable: true,
      });
      verifyPayload(committed, opts.expectedSha256, opts.signature, opts.publicKeyHex);
    } catch (error) {
      rmSync(finalPath, { force: false, maxRetries: 0 });
      throw error;
    }
    return { path: finalPath, bytes: complete.length, kind };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  let currentUrl = opts.url;
  assertSafeDownloadUrl(currentUrl);
  const cancelBody = async (response: Response | undefined): Promise<void> => {
    try {
      await response?.body?.cancel?.();
    } catch {
      /* hop bodies are discarded */
    }
  };
  let hopRes: Response | undefined;
  for (let hop = 0; hop <= 3; hop += 1) {
    hopRes = await fetchImpl(currentUrl, {
      redirect: "manual",
      method: "HEAD",
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (hopRes.status === 405 || hopRes.status === 501) {
      await cancelBody(hopRes);
      hopRes = await fetchImpl(currentUrl, {
        redirect: "manual",
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    }
    if (hopRes.status < 300 || hopRes.status >= 400) break;
    const location = hopRes.headers.get("location");
    await cancelBody(hopRes);
    if (!location || hop === 3) {
      throw new PenglaiError("SECURITY_POLICY", "update redirect refused");
    }
    currentUrl = new URL(location, currentUrl).href;
    assertSafeDownloadUrl(currentUrl);
    hopRes = undefined;
  }
  await cancelBody(hopRes);
  const rangeHeaders = existing > 0 ? { Range: `bytes=${existing}-` } : undefined;
  let res = await fetchImpl(currentUrl, {
    redirect: "manual",
    ...(rangeHeaders ? { headers: rangeHeaders } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (res.status >= 300 && res.status < 400) {
    await cancelBody(res);
    throw new PenglaiError("SECURITY_POLICY", "update redirect refused");
  }
  if (existing > 0 && res.status === 200) {
    existing = 0;
  } else if (existing > 0) {
    if (res.status !== 206) {
      throw new PenglaiError("DELIVERY_TRANSIENT", `update resume failed: ${res.status}`);
    }
    const contentRange = res.headers.get("content-range");
    const expectedRange = `bytes ${existing}-${opts.expectedSize - 1}/${opts.expectedSize}`;
    if (contentRange !== expectedRange) {
      throw new PenglaiError("SECURITY_POLICY", "update Content-Range mismatch");
    }
  } else if (res.status !== 200) {
    throw new PenglaiError("DELIVERY_TRANSIENT", `update download failed: ${res.status}`);
  }
  if (!res.body) throw new PenglaiError("DELIVERY_TRANSIENT", "update download empty");
  const contentLength = res.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) !== opts.expectedSize - existing) {
    throw new PenglaiError("SECURITY_POLICY", "update Content-Length mismatch");
  }
  const flags = existing > 0 ? "a" : "w";
  let streamed = 0;
  const bound = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      streamed += chunk.length;
      if (existing + streamed > opts.expectedSize) {
        callback(new PenglaiError("SECURITY_POLICY", "update payload exceeded declared size"));
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    const source = Readable.fromWeb(res.body as never);
    const destination = createWriteStream(part, { flags, mode: 0o600 });
    if (opts.signal) await pipeline(source, bound, destination, { signal: opts.signal });
    else await pipeline(source, bound, destination);
  } catch (error) {
    if (existsSync(part)) chmodSync(part, 0o600);
    if (error instanceof PenglaiError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (opts.signal?.aborted || (error as Error).name === "AbortError") {
      throw new PenglaiError("DELIVERY_TRANSIENT", "update download cancelled");
    }
    throw new PenglaiError("DELIVERY_TRANSIENT", `update download interrupted: ${code ?? "UNKNOWN"}`);
  }
  chmodSync(part, 0o600);
  // Windows rejects FlushFileBuffers for a read-only handle. Reopen the
  // app-private partial payload read/write so fsync is a real durability gate
  // on every supported host, without changing its already-bounded contents.
  const fileHandle = openSync(part, "r+");
  let buf: Buffer;
  try {
    fsyncSync(fileHandle);
    const opened = fstatSync(fileHandle);
    if (!opened.isFile() || opened.size !== opts.expectedSize) {
      throw new PenglaiError("SECURITY_POLICY", "update size mismatch");
    }
    buf = readFileSync(fileHandle);
  } finally {
    closeSync(fileHandle);
  }
  const bytes = buf.length;
  if (bytes !== opts.expectedSize) throw new PenglaiError("SECURITY_POLICY", "update size mismatch");
  try {
    verifyPayload(buf, opts.expectedSha256, opts.signature, opts.publicKeyHex);
  } catch (error) {
    rmSync(part, { force: false, maxRetries: 0 });
    throw error;
  }
  renameSync(part, finalPath);
  chmodSync(finalPath, 0o600);
  try {
    const committed = readBoundUpdatePayload(finalPath, opts.expectedSize, {
      forbidExecutable: true,
    });
    verifyPayload(committed, opts.expectedSha256, opts.signature, opts.publicKeyHex);
  } catch (error) {
    rmSync(finalPath, { force: false, maxRetries: 0 });
    throw error;
  }
  if (process.platform !== "win32") {
    const dirHandle = openSync(opts.destDir, "r");
    try {
      fsyncSync(dirHandle);
    } finally {
      closeSync(dirHandle);
    }
  }
  return { path: finalPath, bytes, kind };
}

export function drainOwnedServices(flags: {
  dshRunning: boolean;
  asrBusy: boolean;
  ttsBusy: boolean;
  indexerBusy: boolean;
  companionArmed: boolean;
}): { drained: boolean } {
  if (flags.dshRunning || flags.asrBusy || flags.ttsBusy || flags.indexerBusy || flags.companionArmed) {
    throw new PenglaiError("INVALID_INPUT", "owned services still busy");
  }
  return { drained: true };
}

export function crashSafeUpdate(journal: UpdateJournal): UpdateState {
  if (["CHECKING", "AVAILABLE", "DOWNLOADING", "VERIFYING", "READY_FOR_USER"].includes(journal.state)) {
    return "IDLE";
  }
  if (["INSTALL_REQUESTED", "DRAINING_DSH", "DATA_BACKUP_READY"].includes(journal.state)) {
    return "ROLLED_BACK";
  }
  if (journal.state === "HANDOFF_TO_INSTALLER") return "RECOVERY_REQUIRED";
  return journal.state;
}

export function persistAndAdvance(
  dir: string,
  journal: UpdateJournal,
  event: Parameters<typeof nextUpdateState>[1],
): UpdateJournal {
  const next = { ...journal, state: nextUpdateState(journal.state, event) };
  writeUpdateJournal(dir, next);
  return next;
}

export function rollbackStaging(stagingDir: string, trustedUpdatesRoot: string): void {
  if (!existsSync(stagingDir)) return;
  if (!isAbsolute(stagingDir) || !isAbsolute(trustedUpdatesRoot)) {
    throw new PenglaiError("SECURITY_POLICY", "update rollback paths must be absolute");
  }
  const target = resolve(stagingDir);
  const root = resolve(trustedUpdatesRoot);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new PenglaiError("SECURITY_POLICY", "update rollback escaped trusted root");
  }
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new PenglaiError("SECURITY_POLICY", "update rollback target must be a directory");
  }
  rmSync(target, { recursive: true, force: false, maxRetries: 0 });
  mkdirSync(dirname(stagingDir), { recursive: true, mode: 0o700 });
}
