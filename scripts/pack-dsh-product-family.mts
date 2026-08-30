import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    out: { type: "string" },
  },
  allowPositionals: false,
});
if (!values.source || !values.out) {
  throw new Error("usage: pack-dsh-product-family.mts --source <DSH checkout> --out <directory>");
}

const source = resolve(values.source);
const output = resolve(values.out);
const familiesModule = await import(pathToFileURL(join(source, "scripts/release/families.ts")).href);
const tarballModule = await import(pathToFileURL(join(source, "scripts/release/tarball.ts")).href);
const family = familiesModule.releaseFamily("dsh");
const members = family.publishOrder(family.members(source)).order;
family.verifyVersions(members);

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const filenames: string[] = [];
for (const member of members) {
  const result = spawnSync("corepack", ["pnpm", "--dir", member.directory, "pack", "--pack-destination", output], {
    cwd: source,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${member.name} pack failed with status ${String(result.status)}`);
  }
  const filename = familiesModule.tarballName(member);
  const tarball = join(output, filename);
  if (!existsSync(tarball)) throw new Error(`${member.name} produced no tarball at ${tarball}`);
  family.validatePayload(member, tarballModule.tarballFiles(tarball));
  filenames.push(filename);
}
writeFileSync(join(output, "publish-order.txt"), `${filenames.join("\n")}\n`);
console.log(`Penglai source closure: packed ${String(filenames.length)} DSH package(s)`);
