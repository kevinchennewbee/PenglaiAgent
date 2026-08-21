import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const previous = existsSync(nextEpochPath) ? JSON.parse(readFileSync(nextEpochPath, "utf8")) : { epoch: 1 };
const epoch = Number(previous.epoch ?? 1) + 1;
const pair = generateKeyPairSync("ed25519");
const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
const publicHex = Buffer.from(pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32)).toString("hex");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(join(root, `${kind}-ed25519-private.epoch-${epoch}.${stamp}.pem`), privatePem, { mode: 0o600 });
writeFileSync(
  join(root, `${kind}-ed25519-public.epoch-${epoch}.json`),
  `${JSON.stringify({ kind, epoch, publicKeyHex: publicHex, keyId: publicHex.slice(0, 24), createdAt: new Date().toISOString() }, null, 2)}\n`,
);
writeFileSync(nextEpochPath, `${JSON.stringify({ kind, epoch, keyId: publicHex.slice(0, 24) }, null, 2)}\n`);
console.log(`rotated ${kind} to epoch ${epoch}; embed the new public key before publishing`);
console.log("private key was not printed");
