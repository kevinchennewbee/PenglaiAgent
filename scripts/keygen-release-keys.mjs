import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(homedir(), "Library", "Application Support", "PenglaiReleaseKeys");
if (existsSync(join(root, "updater-ed25519-private.pem"))) {
  console.error("PenglaiReleaseKeys already exist; refusing to overwrite");
  process.exit(2);
}
mkdirSync(root, { recursive: true, mode: 0o700 });
chmodSync(root, 0o700);

function writePair(kind) {
  const pair = generateKeyPairSync("ed25519");
  const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicDer = pair.publicKey.export({ type: "spki", format: "der" });
  const publicHex = Buffer.from(publicDer.subarray(-32)).toString("hex");
  const privatePath = join(root, `${kind}-ed25519-private.pem`);
  const publicPath = join(root, `${kind}-ed25519-public.json`);
  writeFileSync(privatePath, privatePem, { mode: 0o600 });
  chmodSync(privatePath, 0o600);
  writeFileSync(
    publicPath,
    `${JSON.stringify({ kind, publicKeyHex: publicHex, keyId: publicHex.slice(0, 24), createdAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o644 },
  );
  return { kind, keyId: publicHex.slice(0, 24), publicKeyHex: publicHex };
}

const updater = writePair("updater");
const plugin = writePair("plugin-catalog");
writeFileSync(
  join(root, "key-inventory.json"),
  `${JSON.stringify({ createdAt: new Date().toISOString(), keys: [updater, plugin] }, null, 2)}\n`,
  { mode: 0o644 },
);
console.log(`wrote ${root}`);
console.log(`updater keyId ${updater.keyId}`);
console.log(`plugin-catalog keyId ${plugin.keyId}`);
console.log("private keys were not printed");
