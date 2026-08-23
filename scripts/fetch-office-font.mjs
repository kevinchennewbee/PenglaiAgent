import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXPECTED_SHA256 = "d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964";
const EXPECTED_BYTES = 17_773_132;
const COMMIT = "f8d157532fbfaeda587e826d4cd5b21a49186f7c";
const URL = `https://raw.githubusercontent.com/notofonts/noto-cjk/${COMMIT}/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf`;
const target = join(ROOT, "packages", "office", "fonts", "NotoSansSC-VF.ttf");
const temp = `${target}.${process.pid}.tmp`;

const response = await fetch(URL, { redirect: "error" });
if (!response.ok) throw new Error(`office font download failed: HTTP ${response.status}`);
if (response.url !== URL) throw new Error("office font response URL changed");
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length !== EXPECTED_BYTES) throw new Error(`office font byte length mismatch: ${bytes.length}`);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== EXPECTED_SHA256) {
  throw new Error(`office font sha256 mismatch: ${sha256}`);
}
await mkdir(dirname(target), { recursive: true });
// The response has an exact pinned URL, byte length and SHA-256 above. The
// exclusive sibling is renamed only after all three checks pass.
// lgtm[js/http-to-file-access]
await writeFile(temp, bytes, { flag: "wx", mode: 0o644 });
await rename(temp, target);
await rm(join(dirname(target), "PenglaiCjkOfl.ttf"), { force: true });
console.log(JSON.stringify({ target, bytes: bytes.length, sha256 }));
