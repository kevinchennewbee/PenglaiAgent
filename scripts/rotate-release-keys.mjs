import { generateKeyPairSync, randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(homedir(), "Library", "Application Support", "PenglaiReleaseKeys");
mkdirSync(root, { recursive: true, mode: 0o700 });
chmodSync(root, 0o700);
const kind = process.argv[2];
if (kind !== "updater" && kind !== "plugin-catalog") {
  console.error("usage: node scripts/rotate-release-keys.mjs updater|plugin-catalog");
  process.exit(2);
}
const nextEpochPath = join(root, `${kind}-epoch.json`);
let previous = { epoch: 1 };
let epochFd;
try {
  const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  epochFd = openSync(nextEpochPath, constants.O_RDONLY | noFollow);
  const before = fstatSync(epochFd);
  if (!before.isFile() || before.size > 64 * 1024) throw new Error("release key epoch is not a bounded regular file");
  previous = JSON.parse(readFileSync(epochFd, "utf8"));
  const after = fstatSync(epochFd);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
    throw new Error("release key epoch changed while open");
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
} finally {
  if (epochFd !== undefined) closeSync(epochFd);
}
const epoch = Number(previous.epoch ?? 1) + 1;
const pair = generateKeyPairSync("ed25519");
const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
const publicHex = Buffer.from(pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32)).toString("hex");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const privatePath = join(root, `${kind}-ed25519-private.epoch-${epoch}.${stamp}.pem`);
const publicPath = join(root, `${kind}-ed25519-public.epoch-${epoch}.json`);
const epochTemp = join(root, `.${kind}-epoch.${process.pid}.${randomUUID()}.tmp`);
let privateCreated = false;
let publicCreated = false;
let committed = false;
try {
  writeFileSync(privatePath, privatePem, { mode: 0o600, flag: "wx" });
  privateCreated = true;
  writeFileSync(
    publicPath,
    `${JSON.stringify({ kind, epoch, publicKeyHex: publicHex, keyId: publicHex.slice(0, 24), createdAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600, flag: "wx" },
  );
  publicCreated = true;
  writeFileSync(epochTemp, `${JSON.stringify({ kind, epoch, keyId: publicHex.slice(0, 24) }, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  renameSync(epochTemp, nextEpochPath);
  committed = true;
} finally {
  rmSync(epochTemp, { force: true });
  if (!committed && publicCreated) rmSync(publicPath, { force: true });
  if (!committed && privateCreated) rmSync(privatePath, { force: true });
}
console.log(`rotated ${kind} to epoch ${epoch}; embed the new public key before publishing`);
console.log("private key was not printed");
